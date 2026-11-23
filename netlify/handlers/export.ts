import { route } from "../lib/router";
import { q } from "../lib/db";
import { HttpError, readJson } from "../lib/http";
import { audit, can, type SessionUser } from "../lib/auth";
import { MAX_EXPORT_ROWS, ORG_TZ } from "../lib/config";
import { TX_FROM, Where, applyBatchFilters, describeFilters, parseFilters, txWhere, type Filters } from "../lib/filters";
import { auditWhere, parseAuditFilters } from "./audit";
import { buildWorkbook, type Sheet } from "../lib/workbook";
import { BATCH_FROM } from "./recon";

const TAG_MEANING: Record<string, [string, string]> = {
  P2S: ["Pending to Success", "Normal transition"],
  P2F: ["Pending to Failed", "Normal transition"],
  F2S: ["Failed to Success", "Audit exception"],
  S2F: ["Success to Failed", "Audit exception"],
};


/** Timestamp rendered in the organisation's timezone, evaluated in SQL. */
const ts = (col: string, tz: string) => `to_char(${col} AT TIME ZONE ${tz}::text, 'YYYY-MM-DD HH24:MI')`;

type Builder = (f: Filters, user: SessionUser, raw: any) => Promise<{ sheets: Sheet[]; truncated?: boolean }>;

/** Shared pieces for transaction-level reports. All use the on-screen filters and the user's data scope. */
function txBase(f: Filters, user: SessionUser) {
  const w = txWhere(f, user);
  const tz = w.push(ORG_TZ());
  return { w, tz };
}

async function exceptionSheets(f: Filters, user: SessionUser, extra: Partial<Filters> = {}) {
  const ff = { ...f, ...extra, onlyExceptions: true };
  const { w, tz } = txBase(ff, user);
  const register = await q(
    `SELECT e.display_id AS "Exception ID", t.display_id AS "Transaction record ID", t.trans_id AS "Trans ID", t.trans_date::text AS "Trans Date",
            b.recon_date::text AS "Recon Date", b.reference AS "Batch", tm.name AS "Terminator", t.tag AS "Tag",
            e.status AS "Status", e.issue_description AS "Issue description", e.follow_up_name AS "Follow-up person",
            (SELECT count(*) FROM exception_comments c WHERE c.exception_id = e.id)::int AS "Comments",
            (SELECT body FROM exception_comments c WHERE c.exception_id = e.id ORDER BY c.id DESC LIMIT 1) AS "Latest comment",
            (SELECT explanation FROM exception_resolutions r WHERE r.exception_id = e.id ORDER BY r.id DESC LIMIT 1) AS "Resolution explanation",
            (SELECT evidence_reference FROM exception_resolutions r WHERE r.exception_id = e.id ORDER BY r.id DESC LIMIT 1) AS "Evidence reference",
            e.closure_note AS "Closure note", e.closed_by_name AS "Closed by", e.closed_by_role AS "Closed as role", ${ts("e.closed_at", tz)} AS "Closed at",
            ${ts("e.created_at", tz)} AS "Created at", (current_date - e.created_at::date)::int AS "Age (days)", ${ts("e.last_activity_at", tz)} AS "Last activity"
       ${TX_FROM} ${w.sql} ORDER BY e.id LIMIT ${MAX_EXPORT_ROWS + 1}`,
    w.params,
  );
  const truncated = register.length > MAX_EXPORT_ROWS;
  if (truncated) register.pop();
  const wc = txBase(ff, user);
  const comments = await q(
    `SELECT e.display_id AS "Exception ID", t.display_id AS "Transaction record ID", t.trans_id AS "Trans ID", c.author_name AS "Author", c.author_role AS "Role",
            ${ts("c.created_at", wc.tz)} AS "Date/time", c.body AS "Comment"
       ${TX_FROM} JOIN exception_comments c ON c.exception_id = e.id ${wc.w.sql} ORDER BY e.id, c.id LIMIT ${MAX_EXPORT_ROWS}`,
    wc.w.params,
  );
  const wh = txBase(ff, user);
  const history = await q(
    `SELECT e.display_id AS "Exception ID", t.display_id AS "Transaction record ID", t.trans_id AS "Trans ID", ${ts("ev.created_at", wh.tz)} AS "Date/time",
            ev.event_type AS "Event", ev.actor_name AS "By", ev.actor_role AS "Role", ev.detail::text AS "Detail"
       ${TX_FROM} JOIN exception_events ev ON ev.exception_id = e.id ${wh.w.sql} ORDER BY e.id, ev.created_at, ev.id LIMIT ${MAX_EXPORT_ROWS}`,
    wh.w.params,
  );
  const wa = txBase(ff, user);
  const assignments = await q(
    `SELECT e.display_id AS "Exception ID", t.trans_id AS "Trans ID", a.follow_up_name AS "Assigned to", a.previous_name AS "Previously",
            (SELECT full_name FROM users WHERE id = a.assigned_by) AS "Assigned by", ${ts("a.assigned_at", wa.tz)} AS "Date/time"
       ${TX_FROM} JOIN exception_assignments a ON a.exception_id = e.id ${wa.w.sql} ORDER BY e.id, a.id LIMIT ${MAX_EXPORT_ROWS}`,
    wa.w.params,
  );
  return { register, comments, history, assignments, truncated };
}

const needExceptions = (user: SessionUser) => {
  if (!can(user, "exceptions.view")) throw new HttpError(403, "You do not have permission to export exception data.");
};

const REPORTS: Record<string, { title: string; build: Builder }> = {
  transactions: {
    title: "Transaction Detail / Search Results",
    build: async (f, user) => {
      const { w, tz } = txBase(f, user);
      const withExc = can(user, "exceptions.view");
      const results = await q(
        `SELECT t.display_id AS "ID", t.trans_id AS "Trans ID", t.trans_date::text AS "Trans Date", b.recon_date::text AS "Recon Date", b.reference AS "Batch",
                tm.name AS "Terminator", t.tag AS "Tag"
                ${withExc ? `, e.display_id AS "Exception ID", e.status AS "Exception status", e.follow_up_name AS "Follow-up person",
                (SELECT count(*) FROM exception_comments c WHERE c.exception_id = e.id)::int AS "Comments",
                (SELECT body FROM exception_comments c WHERE c.exception_id = e.id ORDER BY c.id DESC LIMIT 1) AS "Latest comment",
                COALESCE((SELECT explanation FROM exception_resolutions r WHERE r.exception_id = e.id ORDER BY r.id DESC LIMIT 1), CASE WHEN e.id IS NULL THEN 'Not applicable' ELSE 'Not submitted' END) AS "Resolution",
                e.closure_note AS "Closure note", e.closed_by_name AS "Closed by", ${ts("e.closed_at", tz)} AS "Closed at"` : ""}
           ${TX_FROM} ${w.sql} ORDER BY b.recon_date DESC, t.id LIMIT ${MAX_EXPORT_ROWS + 1}`,
        w.params,
      );
      const truncated = results.length > MAX_EXPORT_ROWS;
      if (truncated) results.pop();
      const sheets: Sheet[] = [{ name: "Results", rows: results }];
      if (withExc) {
        const x = await exceptionSheets(f, user);
        sheets.push({ name: "Comments", rows: x.comments, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Author", "Role", "Date/time", "Comment"] });
        sheets.push({ name: "History", rows: x.history, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Date/time", "Event", "By", "Role", "Detail"] });
      }
      const wb = new Where();
      applyBatchFilters(wb, f, user);
      const batches = await batchRows(wb, user);
      sheets.push({ name: "Batch Summary", rows: batches });
      return { sheets, truncated };
    },
  },
  summary: {
    title: "Reconciliation Summary",
    build: async (f, user) => {
      const w = new Where();
      applyBatchFilters(w, f, user);
      return { sheets: [{ name: "Reconciliation Summary", rows: await batchRows(w, user) }] };
    },
  },
  "status-change": {
    title: "Status Change Report",
    build: async (f, user) => {
      const w = txWhere(f, user);
      const counts = await q(`SELECT t.tag AS tag, count(*)::int AS n ${TX_FROM} ${w.sql} GROUP BY t.tag`, w.params);
      const summary = (["P2S", "P2F", "F2S", "S2F"] as const).map((tag) => ({
        Tag: tag, Meaning: TAG_MEANING[tag][0], Classification: TAG_MEANING[tag][1], Count: counts.find((c) => c.tag === tag)?.n ?? 0,
      }));
      const w2 = txWhere(f, user);
      const rows = await q(
        `SELECT t.display_id AS "ID", t.trans_id AS "Trans ID", t.trans_date::text AS "Trans Date", b.recon_date::text AS "Recon Date", b.reference AS "Batch",
                tm.name AS "Terminator", t.tag AS "Tag" ${TX_FROM} ${w2.sql} ORDER BY t.tag, b.recon_date DESC, t.id LIMIT ${MAX_EXPORT_ROWS + 1}`,
        w2.params,
      );
      const truncated = rows.length > MAX_EXPORT_ROWS;
      if (truncated) rows.pop();
      rows.forEach((r) => (r["Transition"] = TAG_MEANING[r["Tag"]]?.[0]));
      return { sheets: [{ name: "Summary", rows: summary }, { name: "Transactions", rows }], truncated };
    },
  },
  exceptions: {
    title: "Exception Register",
    build: async (f, user) => {
      needExceptions(user);
      const x = await exceptionSheets(f, user);
      return {
        truncated: x.truncated,
        sheets: [
          { name: "Exceptions", rows: x.register },
          { name: "Comments", rows: x.comments, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Author", "Role", "Date/time", "Comment"] },
          { name: "Assignments", rows: x.assignments },
          { name: "History", rows: x.history, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Date/time", "Event", "By", "Role", "Detail"] },
        ],
      };
    },
  },
  outstanding: {
    title: "Outstanding Exceptions",
    build: async (f, user) => {
      needExceptions(user);
      const x = await exceptionSheets(f, user, { outstandingOnly: true });
      const cols = ["Exception ID", "Trans ID", "Trans Date", "Recon Date", "Terminator", "Tag", "Status", "Follow-up person", "Age (days)", "Created at", "Last activity", "Latest comment", "Resolution explanation"];
      const rows = x.register.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      rows.sort((a, b) => (b["Age (days)"] ?? 0) - (a["Age (days)"] ?? 0));
      return { sheets: [{ name: "Outstanding", rows, columns: cols }], truncated: x.truncated };
    },
  },
  closed: {
    title: "Closed Exceptions",
    build: async (f, user) => {
      needExceptions(user);
      const x = await exceptionSheets(f, user, { exceptionStatus: ["closed"] });
      const cols = ["Exception ID", "Trans ID", "Trans Date", "Recon Date", "Terminator", "Tag", "Follow-up person", "Resolution explanation", "Evidence reference", "Closure note", "Closed by", "Closed as role", "Closed at"];
      return { sheets: [{ name: "Closed", rows: x.register.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), columns: cols }], truncated: x.truncated };
    },
  },
  followup: {
    title: "Follow-up Activity",
    build: async (f, user) => {
      needExceptions(user);
      const x = await exceptionSheets(f, user);
      return {
        truncated: x.truncated,
        sheets: [
          { name: "Activity", rows: x.history, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Date/time", "Event", "By", "Role", "Detail"] },
          { name: "Comments", rows: x.comments, columns: ["Exception ID", "Transaction record ID", "Trans ID", "Author", "Role", "Date/time", "Comment"] },
          { name: "Assignments", rows: x.assignments, columns: ["Exception ID", "Trans ID", "Assigned to", "Previously", "Assigned by", "Date/time"] },
        ],
      };
    },
  },
  officers: {
    title: "Officer Activity",
    build: async (f, user) => {
      const p = new Where();
      p.add(`true`);
      const tz = p.push(ORG_TZ());
      const dateFilter = (col: string) => {
        let s = "";
        if (f.reconFrom) s += ` AND (${col} AT TIME ZONE ${tz}::text)::date >= ${p.push(f.reconFrom)}::date`;
        if (f.reconTo) s += ` AND (${col} AT TIME ZONE ${tz}::text)::date <= ${p.push(f.reconTo)}::date`;
        return s;
      };
      const scope = user.terminatorScope.length ? ` AND b.terminator_id = ANY(${p.push(user.terminatorScope)}::int[])` : "";
      const rows = await q(
        `SELECT u.full_name AS "User", u.username AS "Username",
                (SELECT count(*) FROM reconciliation_batches b WHERE b.uploaded_by = u.id${scope}${dateFilter("b.submitted_at")})::int AS "Submissions",
                COALESCE((SELECT sum(b.transaction_count) FROM reconciliation_batches b WHERE b.uploaded_by = u.id${scope}${dateFilter("b.submitted_at")}), 0)::int AS "Transactions imported",
                (SELECT count(*) FROM exception_comments c WHERE c.author_id = u.id${dateFilter("c.created_at")})::int AS "Comments",
                (SELECT count(*) FROM exception_resolutions r WHERE r.submitted_by = u.id${dateFilter("r.submitted_at")})::int AS "Resolutions submitted",
                (SELECT count(*) FROM exception_closures x WHERE x.user_id = u.id AND x.action = 'closed'${dateFilter("x.created_at")})::int AS "Exceptions closed",
                (SELECT count(*) FROM exception_closures x WHERE x.user_id = u.id AND x.action = 'reopened'${dateFilter("x.created_at")})::int AS "Exceptions reopened",
                (SELECT count(*) FROM exception_assignments a WHERE a.assigned_by = u.id${dateFilter("a.assigned_at")})::int AS "Assignments made"
           FROM users u ORDER BY u.full_name`,
        p.params,
      );
      return { sheets: [{ name: "Officer Activity", rows }] };
    },
  },
  audit: {
    title: "Audit Trail",
    build: async (_f, user, raw) => {
      if (!can(user, "audit.view")) throw new HttpError(403, "You do not have permission to export the audit trail.");
      const w = auditWhere(parseAuditFilters(raw?.auditFilters), ORG_TZ());
      const tz = w.push(ORG_TZ());
      const rows = await q(
        `SELECT a.id::int AS "Seq", ${ts("a.occurred_at", tz)} AS "Date/time", a.username AS "User", a.role_name AS "Role", a.action AS "Action",
                a.entity_type AS "Entity", a.entity_id AS "Entity ID", a.detail::text AS "Detail (before/after where applicable)", a.hash AS "Hash"
           FROM audit_logs a ${w.sql} ORDER BY a.id DESC LIMIT ${MAX_EXPORT_ROWS + 1}`,
        w.params,
      );
      const truncated = rows.length > MAX_EXPORT_ROWS;
      if (truncated) rows.pop();
      return { sheets: [{ name: "Audit Trail", rows }], truncated };
    },
  },
};

async function batchRows(w: Where, user: SessionUser) {
  void user;
  const tz = w.push(ORG_TZ());
  return q(
    `SELECT b.reference AS "Batch", b.version AS "Version", CASE WHEN b.is_current THEN 'Current' ELSE 'Superseded' END AS "Version state",
            tm.name AS "Terminator", b.recon_date::text AS "Recon Date", ${ts("b.submitted_at", tz)} AS "Submitted at", rs.name AS "Reconciliation status",
            up.full_name AS "Uploaded by", b.original_filename AS "File", b.txn_date_min::text AS "Earliest Trans Date", b.txn_date_max::text AS "Latest Trans Date",
            b.transaction_count AS "Transactions", b.p2s_count AS "P2S", b.p2f_count AS "P2F", b.f2s_count AS "F2S", b.s2f_count AS "S2F",
            b.exception_count AS "Exceptions", b.exception_pct::float8 AS "Exception %", b.rejected_count AS "Rejected rows",
            b.officer_remarks AS "Officer remarks", b.correction_reason AS "Correction reason"
       ${BATCH_FROM} ${w.sql} ORDER BY b.submitted_at DESC LIMIT ${MAX_EXPORT_ROWS}`,
    w.params,
  );
}

route("POST", "/export/:report", { perm: "reports.export" }, async ({ req, user, params }) => {
  const def = REPORTS[params.report];
  if (!def) throw new HttpError(404, "Unknown report.");
  const body = await readJson(req);
  const f = parseFilters(body.filters);
  const out = await def.build(f, user, body);
  const generated = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: ORG_TZ() }).format(new Date());
  const info: Sheet = {
    name: "Report Info",
    columns: ["Item", "Value"],
    rows: [
      { Item: "Report", Value: def.title },
      { Item: "Generated", Value: `${generated} (${ORG_TZ()})` },
      { Item: "Generated by", Value: `${user.fullName} (${user.username})` },
      { Item: "Filters applied", Value: params.report === "audit" ? JSON.stringify(body.auditFilters ?? {}) : describeFilters(f) },
      { Item: "Data scope", Value: user.terminatorScope.length ? "Restricted to assigned terminators" : "All terminators" },
      ...(out.truncated ? [{ Item: "Note", Value: `Results were limited to the first ${MAX_EXPORT_ROWS} rows. Narrow the filters to export the rest.` }] : []),
    ],
  };
  const bytes = buildWorkbook([info, ...out.sheets]);
  await audit(user, "report.exported", "report", params.report, { filters: params.report === "audit" ? body.auditFilters : f });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="RAMS_${params.report}_${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
