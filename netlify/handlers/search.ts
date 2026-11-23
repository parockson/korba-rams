import { route } from "../lib/router";
import { one, q } from "../lib/db";
import { HttpError, json, readJson, reqInt } from "../lib/http";
import { can } from "../lib/auth";
import { TX_FROM, parseFilters, scopeBatches, txWhere, Where } from "../lib/filters";

export const RESULT_COLS = `
  t.id::int AS "id", t.display_id AS "displayId", t.trans_id AS "transId", t.trans_date::text AS "transDate",
  b.recon_date::text AS "reconDate", b.id::int AS "batchId", b.reference AS "batchRef", b.version AS "batchVersion", b.is_current AS "batchIsCurrent",
  tm.name AS terminator, t.tag,
  e.id::int AS "exceptionId", e.display_id AS "exceptionDisplayId", e.status AS "exceptionStatus", e.follow_up_name AS "followUp",
  e.closure_note AS "closureNote", e.closed_by_name AS "closedBy", e.closed_at AS "closedAt",
  e.created_at AS "exceptionCreatedAt", e.last_activity_at AS "lastActivityAt",
  CASE WHEN e.id IS NULL THEN NULL ELSE (current_date - e.created_at::date)::int END AS "ageDays",
  (SELECT count(*)::int FROM exception_comments c WHERE c.exception_id = e.id) AS "commentCount",
  (SELECT left(c.body, 160) FROM exception_comments c WHERE c.exception_id = e.id ORDER BY c.id DESC LIMIT 1) AS "latestComment",
  (SELECT left(r.explanation, 160) FROM exception_resolutions r WHERE r.exception_id = e.id ORDER BY r.id DESC LIMIT 1) AS "resolution",
  (SELECT count(*)::int FROM transaction_records t2 WHERE lower(t2.trans_id) = lower(t.trans_id)) AS "occurrences"`;

const SORTS: Record<string, string> = {
  recent: "b.recon_date DESC, t.id DESC",
  oldest: "e.created_at ASC NULLS LAST, t.id ASC",
  activity: "e.last_activity_at ASC NULLS LAST, t.id ASC",
  transDate: "t.trans_date DESC, t.id DESC",
};

route("POST", "/search", { perm: "recon.view" }, async ({ req, user }) => {
  const body = await readJson(req);
  const f = parseFilters(body.filters);
  // viewers without exception access never see exception data
  if (!can(user, "exceptions.view") && (f.onlyExceptions || f.exceptionStatus || f.outstandingOnly)) {
    throw new HttpError(403, "You do not have permission to view exceptions.");
  }
  const w = txWhere(f, user);
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 50, 1), 200);
  const page = Math.max(Number(body.page) || 1, 1);
  const order = SORTS[f.sort ?? "recent"] ?? SORTS.recent;
  const rows = await q(
    `SELECT ${RESULT_COLS}, count(*) OVER()::int AS total ${TX_FROM} ${w.sql}
      ORDER BY ${order} LIMIT ${w.push(pageSize)} OFFSET ${w.push((page - 1) * pageSize)}`,
    w.params,
  );
  if (!can(user, "exceptions.view")) {
    for (const r of rows) {
      Object.assign(r, { exceptionId: null, exceptionDisplayId: null, exceptionStatus: null, followUp: null, closureNote: null, closedBy: null, closedAt: null, commentCount: 0, latestComment: null, resolution: null });
    }
  }
  return json({ rows, total: rows[0]?.total ?? 0, page, pageSize });
});

route("GET", "/transactions/:id", { perm: "recon.view" }, async ({ user, params }) => {
  const id = reqInt(params.id, "Transaction");
  const w = new Where().add(`t.id = ?`, id);
  scopeBatches(w, user);
  const tx = await one(
    `SELECT ${RESULT_COLS}, up.full_name AS "uploadedBy", b.submitted_at AS "submittedAt", b.original_filename AS "filename",
            rs.name AS "reconStatus", t.row_number AS "rowNumber", b.officer_remarks AS "officerRemarks"
       ${TX_FROM} ${w.sql}`,
    w.params,
  );
  if (!tx) throw new HttpError(404, "Transaction record not found.");
  const occurrences = await q(
    `SELECT t2.id::int AS id, t2.display_id AS "displayId", t2.trans_date::text AS "transDate", t2.tag, b.recon_date::text AS "reconDate",
            b.id::int AS "batchId", b.reference AS "batchRef", b.version AS "batchVersion", b.is_current AS "batchIsCurrent", tm.name AS terminator,
            e.display_id AS "exceptionDisplayId", e.status AS "exceptionStatus"
       FROM transaction_records t2
       JOIN reconciliation_batches b ON b.id = t2.batch_id
       JOIN terminators tm ON tm.id = b.terminator_id
       LEFT JOIN exceptions e ON e.transaction_id = t2.id
      WHERE lower(t2.trans_id) = lower($1) ${user.terminatorScope.length ? "AND b.terminator_id = ANY($2::int[])" : ""}
      ORDER BY b.submitted_at, t2.id`,
    user.terminatorScope.length ? [tx.transId, user.terminatorScope] : [tx.transId],
  );
  let exception: any = null;
  if (tx.exceptionId && can(user, "exceptions.view")) exception = await loadException(tx.exceptionId);
  return json({ transaction: tx, occurrences, exception });
});

export async function loadException(id: number) {
  const [head, comments, resolutions, closures, assignments, events] = await Promise.all([
    one(
      `SELECT e.id::int AS id, e.display_id AS "displayId", e.status, e.tag, e.issue_description AS "issueDescription",
              e.follow_up_name AS "followUp", e.follow_up_contact_id AS "followUpContactId", e.closed_by_name AS "closedBy", e.closed_by_role AS "closedByRole",
              e.closed_at AS "closedAt", e.closure_note AS "closureNote", e.created_at AS "createdAt", e.last_activity_at AS "lastActivityAt",
              fc.user_id AS "followUpUserId"
         FROM exceptions e LEFT JOIN follow_up_contacts fc ON fc.id = e.follow_up_contact_id WHERE e.id = $1`,
      [id],
    ),
    q(`SELECT id::int, author_name AS "author", author_role AS "role", body, created_at AS "createdAt" FROM exception_comments WHERE exception_id = $1 ORDER BY id`, [id]),
    q(`SELECT id::int, explanation, evidence_reference AS "evidence", submitted_by_name AS "submittedBy", submitted_role AS "role", submitted_at AS "submittedAt" FROM exception_resolutions WHERE exception_id = $1 ORDER BY id`, [id]),
    q(`SELECT id::int, action, note, user_name AS "user", role_name AS "role", created_at AS "createdAt" FROM exception_closures WHERE exception_id = $1 ORDER BY id`, [id]),
    q(`SELECT id::int, follow_up_name AS "name", previous_name AS "previous", assigned_at AS "assignedAt", (SELECT full_name FROM users WHERE id = assigned_by) AS "assignedBy" FROM exception_assignments WHERE exception_id = $1 ORDER BY id`, [id]),
    q(`SELECT id::int, event_type AS "type", actor_name AS "actor", actor_role AS "role", detail, created_at AS "createdAt" FROM exception_events WHERE exception_id = $1 ORDER BY created_at, id`, [id]),
  ]);
  return { ...head, comments, resolutions, closures, assignments, events };
}

/* follow-up name suggestions: previously used names, most used first */
route("GET", "/contacts", { perm: ["exceptions.assign", "exceptions.view"] }, async ({ url }) => {
  const term = (url.searchParams.get("q") ?? "").trim().slice(0, 100).replace(/[\\%_]/g, (c) => "\\" + c);
  const rows = await q(
    `SELECT c.id::int AS id, c.name, c.user_id::int AS "userId", u.username
       FROM follow_up_contacts c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.name ILIKE $1 ESCAPE '\\' ORDER BY c.use_count DESC, c.name LIMIT 10`,
    [`%${term}%`],
  );
  return json({ contacts: rows });
});
