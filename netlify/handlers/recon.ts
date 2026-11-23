import { createHash, randomUUID } from "node:crypto";
import { route } from "../lib/router";
import { one, q } from "../lib/db";
import { HttpError, json, optStr, readJson, reqInt } from "../lib/http";
import { audit, roleFor } from "../lib/auth";
import { MAX_ROWS, MAX_UPLOAD_BYTES, ORG_TZ } from "../lib/config";
import { parseUpload } from "../lib/fileparse";
import { validateTable } from "../lib/validate";
import { deleteFile, evidenceKey, getFile, putFile, stagingKey } from "../lib/storage";
import { Where, applyBatchFilters, parseFilters, scopeBatches } from "../lib/filters";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const safeName = (n: string) => n.replace(/[^\w.\- ()]/g, "_").slice(0, 150);
const TOKEN_RE = /^[0-9a-f-]{36}$/;

function validateFile(filename: string, bytes: Uint8Array) {
  const parsed = parseUpload(filename, bytes);
  const result = validateTable(parsed.rows, { maxRows: MAX_ROWS() });
  result.warnings.unshift(...parsed.warnings);
  return result;
}

/* ---- Step 1: upload + validate + preview. Nothing is committed to the batch tables. ---- */
route("POST", "/recon/preview", { perm: "recon.create" }, async ({ req, user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES()) throw new HttpError(413, `The file is larger than the ${Math.round(MAX_UPLOAD_BYTES() / 1048576)} MB limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = safeName(file.name);
  const result = validateFile(name, bytes);
  const hash = sha256(bytes);
  const token = randomUUID();
  await putFile(stagingKey(token), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    userId: user.id, filename: name, sha256: hash, size: bytes.length,
  });
  const dup = await q(
    `SELECT b.id::int, b.reference, t.name AS terminator, b.recon_date::text AS "reconDate"
       FROM reconciliation_batches b JOIN terminators t ON t.id = b.terminator_id WHERE b.file_sha256 = $1 ORDER BY b.id DESC LIMIT 3`,
    [hash],
  );
  await audit(user, "recon.file_uploaded", "upload", token, {
    filename: name, size: bytes.length, sha256: hash, accepted: result.accepted.length, rejected: result.rejected.length, fatal: result.fatal,
  });
  return json({
    uploadToken: token,
    file: { name, size: bytes.length, sha256: hash },
    fatal: result.fatal,
    warnings: result.warnings,
    summary: result.summary,
    rejectedTotal: result.rejected.length,
    rejected: result.rejected.slice(0, 1000),
    sample: result.accepted.slice(0, 25),
    sameFileSubmittedBefore: dup,
  });
});

/* ---- Step 2 helper: is there already a current submission for this terminator today? ---- */
route("GET", "/recon/check", { perm: "recon.create" }, async ({ url, user }) => {
  const terminatorId = reqInt(url.searchParams.get("terminatorId"), "Terminator");
  const w = new Where().add(`b.terminator_id = ?`, terminatorId).add(`b.is_current`).add(`b.recon_date = (now() AT TIME ZONE ?)::date`, ORG_TZ());
  scopeBatches(w, user);
  const existing = await one(
    `SELECT b.id::int, b.reference, b.version, b.transaction_count AS "transactionCount" FROM reconciliation_batches b ${w.sql} LIMIT 1`,
    w.params,
  );
  const recent = await q(
    `SELECT b.id::int, b.reference, b.version, b.recon_date::text AS "reconDate", b.original_filename AS "filename"
       FROM reconciliation_batches b WHERE b.terminator_id = $1 AND b.is_current ORDER BY b.id DESC LIMIT 15`,
    [terminatorId],
  );
  return json({ existingToday: existing ?? null, recent });
});

/* ---- Step 3: commit. One atomic SQL statement creates batch + transactions + exceptions + audit. ---- */
route("POST", "/recon/submit", { perm: "recon.create" }, async ({ req, user }) => {
  const b = await readJson(req);
  const token = String(b.uploadToken ?? "");
  if (!TOKEN_RE.test(token)) throw new HttpError(400, "The upload has expired. Please upload the file again.");
  const terminatorId = reqInt(b.terminatorId, "Terminator");
  const statusId = reqInt(b.statusId, "Reconciliation status");
  const remarks = optStr(b.officerRemarks, 2000) ?? null;

  const term = await one(`SELECT id, is_active FROM terminators WHERE id = $1`, [terminatorId]);
  if (!term) throw new HttpError(400, "Unknown terminator.");
  if (!term.is_active) throw new HttpError(400, "This terminator is deactivated and cannot receive new submissions.");
  if (user.terminatorScope.length && !user.terminatorScope.includes(terminatorId)) throw new HttpError(403, "You are not permitted to submit for this terminator.");
  const st = await one(`SELECT is_active FROM recon_statuses WHERE id = $1`, [statusId]);
  if (!st?.is_active) throw new HttpError(400, "Choose a valid reconciliation status.");

  let parentId: number | null = null;
  let version = 1;
  let reason: string | null = null;
  if (b.correctsBatchId) {
    parentId = reqInt(b.correctsBatchId, "Original batch");
    reason = optStr(b.correctionReason, 1000) ?? null;
    if (!reason || reason.length < 5) throw new HttpError(400, "State the reason for the correction.");
    const parent = await one(`SELECT terminator_id, version, is_current FROM reconciliation_batches WHERE id = $1`, [parentId]);
    if (!parent) throw new HttpError(400, "The batch being corrected does not exist.");
    if (parent.terminator_id !== terminatorId) throw new HttpError(400, "A correction must use the same terminator as the original batch.");
    if (!parent.is_current) throw new HttpError(409, "That batch has already been superseded by a newer version.");
    version = parent.version + 1;
  }

  const staged = await getFile(stagingKey(token));
  if (!staged || staged.metadata.userId !== user.id) throw new HttpError(400, "The upload has expired. Please upload the file again.");
  const bytes = new Uint8Array(staged.data);
  const filename = String(staged.metadata.filename);
  const result = validateFile(filename, bytes); // the server never trusts the preview
  if (result.fatal.length) throw new HttpError(400, result.fatal.join(" "));
  if (!result.accepted.length) throw new HttpError(400, "There are no valid rows to submit.");
  if (result.rejected.length && !b.acknowledgeRejected) {
    throw new HttpError(400, `${result.rejected.length} row(s) were rejected. Correct the file, or confirm that the rejected rows are excluded and recorded.`, "REJECTED_ROWS");
  }
  const s = result.summary;
  const hash = sha256(bytes);
  const key = evidenceKey(token);
  await putFile(key, staged.data, { filename, sha256: hash, uploadedBy: user.id });

  const p: unknown[] = [];
  const P = (v: unknown) => `$${p.push(v)}`;
  const tz = P(ORG_TZ());
  const termP = P(terminatorId);
  const parentP = P(parentId);
  const uid = P(user.id);
  const roleName = roleFor(user, "recon.create");
  const rowsJson = JSON.stringify(
    result.accepted.map((r) => ({ row_number: r.rowNumber, trans_id: r.transId, trans_date: r.transDate, tag: r.tag })),
  );
  const auditDetail = JSON.stringify({
    filename, sha256: hash, terminatorId, statusId, transactions: s.total, exceptions: s.exceptions,
    rejectedExcluded: result.rejected.length, version, correctsBatchId: parentId, correctionReason: reason,
  });
  const sqlText = `
    WITH ins AS (
      INSERT INTO reconciliation_batches
        (terminator_id, status_id, recon_date, uploaded_by, original_filename, storage_key, file_sha256, file_size,
         txn_date_min, txn_date_max, transaction_count, p2s_count, p2f_count, f2s_count, s2f_count, exception_count,
         exception_pct, rejected_count, rejected_rows, officer_remarks, version, parent_batch_id, correction_reason)
      SELECT ${termP}::int, ${P(statusId)}::int, (now() AT TIME ZONE ${tz}::text)::date, ${uid}::int, ${P(filename)}::text, ${P(key)}::text, ${P(hash)}::text, ${P(bytes.length)}::bigint,
             ${P(s.minDate)}::date, ${P(s.maxDate)}::date, ${P(s.total)}::int, ${P(s.p2s)}::int, ${P(s.p2f)}::int, ${P(s.f2s)}::int, ${P(s.s2f)}::int, ${P(s.exceptions)}::int,
             ${P(s.exceptionPct)}::numeric, ${P(result.rejected.length)}::int, ${P(JSON.stringify(result.rejected.slice(0, 5000)))}::jsonb, ${P(remarks)}::text,
             ${P(version)}::int, ${parentP}::bigint, ${P(reason)}::text
       WHERE (${parentP}::bigint IS NOT NULL OR NOT EXISTS (
               SELECT 1 FROM reconciliation_batches x
                WHERE x.terminator_id = ${termP}::int AND x.is_current AND x.recon_date = (now() AT TIME ZONE ${tz}::text)::date))
         AND (${parentP}::bigint IS NULL OR EXISTS (SELECT 1 FROM reconciliation_batches x WHERE x.id = ${parentP}::bigint AND x.is_current))
      RETURNING id, reference, recon_date
    ), tx AS (
      INSERT INTO transaction_records (batch_id, row_number, trans_id, trans_date, tag)
      SELECT ins.id, r.row_number, r.trans_id, r.trans_date::date, r.tag
        FROM ins, jsonb_to_recordset(${P(rowsJson)}::jsonb) AS r(row_number int, trans_id text, trans_date text, tag text)
      RETURNING id, tag
    ), exc AS (
      INSERT INTO exceptions (transaction_id, batch_id, tag)
      SELECT tx.id, (SELECT id FROM ins), tx.tag FROM tx WHERE tx.tag IN ('F2S','S2F')
      RETURNING id
    ), ev AS (
      INSERT INTO exception_events (exception_id, event_type, actor_id, actor_name, actor_role, detail)
      SELECT exc.id, 'created', ${uid}::int, ${P(user.fullName)}::text, ${P(roleName)}::text,
             jsonb_build_object('batch', (SELECT reference FROM ins), 'note', 'Created automatically from reconciliation submission')
        FROM exc
      RETURNING id
    ), sup AS (
      UPDATE reconciliation_batches SET is_current = false, superseded_by = (SELECT id FROM ins)
       WHERE id = ${parentP}::bigint AND EXISTS (SELECT 1 FROM ins) RETURNING id
    ), aud AS (
      INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
      SELECT ${uid}::int, ${P(user.username)}::text, ${P(roleName)}::text, ${P(parentId ? "recon.revised" : "recon.submitted")}::text,
             'batch', ins.reference, ${P(auditDetail)}::jsonb
        FROM ins
      RETURNING id
    )
    SELECT ins.id::int AS id, ins.reference, ins.recon_date::text AS "reconDate",
           (SELECT count(*)::int FROM tx) AS "transactionCount", (SELECT count(*)::int FROM exc) AS "exceptionCount"
      FROM ins`;

  let row: any;
  try {
    row = await one(sqlText, p);
  } catch (e) {
    await deleteFile(key); // nothing was committed; do not leave orphaned evidence
    throw e;
  }
  if (!row) {
    await deleteFile(key);
    const dup = await one(
      `SELECT id::int, reference FROM reconciliation_batches WHERE terminator_id = $1 AND is_current AND recon_date = (now() AT TIME ZONE $2)::date LIMIT 1`,
      [terminatorId, ORG_TZ()],
    );
    throw new HttpError(
      409,
      dup && !parentId
        ? `A reconciliation for this terminator has already been submitted today (${dup.reference}). If this is a corrected report, submit it as a correction of that batch.`
        : "The batch being corrected has changed. Reload and try again.",
      "DUPLICATE_SUBMISSION",
      dup ? { batchId: dup.id, reference: dup.reference } : undefined,
    );
  }
  await deleteFile(stagingKey(token));
  return json(row, 201);
});

/* ---------------- batches ---------------- */
const BATCH_COLS = `
  b.id::int AS id, b.reference, b.version, b.is_current AS "isCurrent", b.recon_date::text AS "reconDate", b.submitted_at AS "submittedAt",
  tm.id AS "terminatorId", tm.name AS terminator, rs.name AS status, up.full_name AS "uploadedBy", up.id AS "uploadedById",
  b.original_filename AS "filename", b.file_size::int AS "fileSize", b.file_sha256 AS "sha256",
  b.txn_date_min::text AS "txnDateMin", b.txn_date_max::text AS "txnDateMax",
  b.transaction_count AS "transactionCount", b.p2s_count AS p2s, b.p2f_count AS p2f, b.f2s_count AS f2s, b.s2f_count AS s2f,
  b.exception_count AS "exceptionCount", b.exception_pct::float8 AS "exceptionPct", b.rejected_count AS "rejectedCount",
  b.officer_remarks AS "officerRemarks", b.parent_batch_id::int AS "parentBatchId", b.correction_reason AS "correctionReason"`;
export const BATCH_FROM = `
  FROM reconciliation_batches b
  JOIN terminators tm ON tm.id = b.terminator_id
  JOIN recon_statuses rs ON rs.id = b.status_id
  JOIN users up ON up.id = b.uploaded_by`;

route("POST", "/batches/search", { perm: "recon.view" }, async ({ req, user }) => {
  const body = await readJson(req);
  const f = parseFilters(body.filters);
  const w = new Where();
  applyBatchFilters(w, f, user);
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 25, 1), 200);
  const page = Math.max(Number(body.page) || 1, 1);
  const rows = await q(
    `SELECT ${BATCH_COLS}, count(*) OVER()::int AS total ${BATCH_FROM} ${w.sql}
      ORDER BY b.submitted_at DESC, b.id DESC LIMIT ${w.push(pageSize)} OFFSET ${w.push((page - 1) * pageSize)}`,
    w.params,
  );
  return json({ rows, total: rows[0]?.total ?? 0, page, pageSize });
});

route("GET", "/batches/:id", { perm: "recon.view" }, async ({ user, params }) => {
  const id = reqInt(params.id, "Batch");
  const w = new Where().add(`b.id = ?`, id);
  scopeBatches(w, user);
  const batch = await one(`SELECT ${BATCH_COLS}, b.rejected_rows AS "rejectedRows" ${BATCH_FROM} ${w.sql}`, w.params);
  if (!batch) throw new HttpError(404, "Reconciliation batch not found.");
  const versions = await q(
    `WITH RECURSIVE up AS (
       SELECT id, parent_batch_id FROM reconciliation_batches WHERE id = $1
       UNION ALL SELECT x.id, x.parent_batch_id FROM reconciliation_batches x JOIN up ON x.id = up.parent_batch_id),
     down AS (
       SELECT id FROM up WHERE parent_batch_id IS NULL
       UNION ALL SELECT x.id FROM reconciliation_batches x JOIN down d ON x.parent_batch_id = d.id)
     SELECT b.id::int AS id, b.reference, b.version, b.is_current AS "isCurrent", b.submitted_at AS "submittedAt",
            b.transaction_count AS "transactionCount", b.exception_count AS "exceptionCount",
            b.correction_reason AS "correctionReason", u.full_name AS "uploadedBy"
       FROM down JOIN reconciliation_batches b ON b.id = down.id JOIN users u ON u.id = b.uploaded_by ORDER BY b.version`,
    [id],
  );
  const stats = await one(
    `SELECT count(*)::int AS exceptions,
            count(*) FILTER (WHERE status <> 'closed')::int AS outstanding,
            count(*) FILTER (WHERE status = 'closed')::int AS closed
       FROM exceptions WHERE batch_id = $1`,
    [id],
  );
  return json({ batch, versions, exceptionStats: stats });
});

route("GET", "/batches/:id/file", { perm: "recon.view" }, async ({ user, params }) => {
  const id = reqInt(params.id, "Batch");
  const w = new Where().add(`b.id = ?`, id);
  scopeBatches(w, user);
  const b = await one(`SELECT b.storage_key, b.original_filename, b.reference FROM reconciliation_batches b ${w.sql}`, w.params);
  if (!b) throw new HttpError(404, "Reconciliation batch not found.");
  const f = await getFile(b.storage_key);
  if (!f) throw new HttpError(404, "The stored source file could not be found.");
  await audit(user, "recon.file_downloaded", "batch", b.reference, { filename: b.original_filename });
  return new Response(f.data, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${safeName(b.original_filename)}"`,
      "cache-control": "no-store",
    },
  });
});
