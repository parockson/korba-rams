import { route } from "../lib/router";
import { q, one } from "../lib/db";
import { HttpError, escapeLike, isIsoDate, json, optStr, readJson } from "../lib/http";
import { Where } from "../lib/filters";
import { audit } from "../lib/auth";

export interface AuditFilters { from?: string; to?: string; action?: string; username?: string; entityType?: string; entityId?: string }

export function parseAuditFilters(raw: any): AuditFilters {
  const f: AuditFilters = {};
  if (!raw || typeof raw !== "object") return f;
  for (const k of ["from", "to"] as const) if (raw[k]) {
    if (!isIsoDate(raw[k])) throw new HttpError(400, "Audit dates must be yyyy-mm-dd.");
    f[k] = raw[k];
  }
  f.action = optStr(raw.action, 80);
  f.username = optStr(raw.username, 80);
  f.entityType = optStr(raw.entityType, 40);
  f.entityId = optStr(raw.entityId, 60);
  return f;
}

export function auditWhere(f: AuditFilters, tz: string): Where {
  const w = new Where();
  if (f.from) w.add(`(a.occurred_at AT TIME ZONE ?)::date >= ?::date`, tz, f.from);
  if (f.to) w.add(`(a.occurred_at AT TIME ZONE ?)::date <= ?::date`, tz, f.to);
  if (f.action) w.add(`a.action ILIKE ? ESCAPE '\\'`, `%${escapeLike(f.action)}%`);
  if (f.username) w.add(`a.username ILIKE ? ESCAPE '\\'`, `%${escapeLike(f.username)}%`);
  if (f.entityType) w.add(`a.entity_type = ?`, f.entityType);
  if (f.entityId) w.add(`a.entity_id ILIKE ? ESCAPE '\\'`, `%${escapeLike(f.entityId)}%`);
  return w;
}

route("POST", "/audit/search", { perm: "audit.view" }, async ({ req }) => {
  const { ORG_TZ } = await import("../lib/config");
  const body = await readJson(req);
  const w = auditWhere(parseAuditFilters(body.filters), ORG_TZ());
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 50, 1), 200);
  const page = Math.max(Number(body.page) || 1, 1);
  const rows = await q(
    `SELECT a.id::int AS id, a.occurred_at AS "occurredAt", a.username, a.role_name AS role, a.action, a.entity_type AS "entityType",
            a.entity_id AS "entityId", a.detail, count(*) OVER()::int AS total
       FROM audit_logs a ${w.sql} ORDER BY a.id DESC LIMIT ${w.push(pageSize)} OFFSET ${w.push((page - 1) * pageSize)}`,
    w.params,
  );
  return json({ rows, total: rows[0]?.total ?? 0, page, pageSize });
});

/** Recomputes the SHA-256 hash chain. Any edited, inserted or removed (non-tail) row breaks the chain. */
route("GET", "/audit/verify", { perm: "audit.view" }, async ({ user }) => {
  const bad = await q(
    `SELECT id::int AS id FROM (
       SELECT a.id, a.hash, a.prev_hash,
              lag(a.hash) OVER (ORDER BY a.id) AS expected_prev,
              encode(sha256(convert_to(a.prev_hash || '|' || rams_audit_payload(a), 'UTF8')), 'hex') AS recomputed
         FROM audit_logs a) x
      WHERE x.recomputed IS DISTINCT FROM x.hash OR x.prev_hash IS DISTINCT FROM COALESCE(x.expected_prev, 'GENESIS')
      ORDER BY id LIMIT 20`,
  );
  const total = await one(`SELECT count(*)::int AS n FROM audit_logs`);
  await audit(user, "audit.verified", "audit", null, { entries: total?.n, intact: bad.length === 0 });
  return json({ intact: bad.length === 0, entries: total?.n ?? 0, firstBrokenIds: bad.map((b) => b.id) });
});
