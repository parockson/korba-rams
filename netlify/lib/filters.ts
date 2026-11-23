import type { SessionUser } from "./auth";
import { HttpError, escapeLike, intList, isIsoDate, optStr } from "./http";
import { TAGS } from "./validate";

export class Where {
  params: unknown[] = [];
  parts: string[] = [];
  /** Each `?` in `sql` is replaced by the next positional parameter. */
  add(sql: string, ...vals: unknown[]) {
    let i = 0;
    this.parts.push(sql.replace(/\?/g, () => `$${this.params.push(vals[i++])}`));
    return this;
  }
  push(v: unknown) {
    return `$${this.params.push(v)}`;
  }
  get sql() {
    return this.parts.length ? "WHERE " + this.parts.join(" AND ") : "";
  }
}

export const EXC_STATUSES = ["open", "investigating", "resolution_submitted", "closed", "reopened"];

export interface Filters {
  transId?: string;
  transIds?: string[];
  transFrom?: string;
  transTo?: string;
  reconFrom?: string;
  reconTo?: string;
  tags?: string[];
  terminatorIds?: number[];
  exceptionStatus?: string[]; // may include "none" (no exception)
  reconStatusIds?: number[];
  uploaderIds?: number[];
  followUp?: string;
  batchId?: number;
  onlyExceptions?: boolean;
  includeSuperseded?: boolean;
  outstandingOnly?: boolean;
  sort?: string;
}

export function parseFilters(raw: any): Filters {
  const f: Filters = {};
  if (!raw || typeof raw !== "object") return f;
  f.transId = optStr(raw.transId, 100);
  if (raw.transIds !== undefined) {
    const list = (Array.isArray(raw.transIds) ? raw.transIds : String(raw.transIds).split(/[\s,;]+/))
      .map((s: unknown) => String(s).trim())
      .filter(Boolean);
    if (list.length > 5000) throw new HttpError(400, "Bulk search is limited to 5,000 transaction IDs.");
    if (list.length) f.transIds = [...new Set<string>(list)];
  }
  for (const k of ["transFrom", "transTo", "reconFrom", "reconTo"] as const) {
    if (raw[k]) {
      if (!isIsoDate(raw[k])) throw new HttpError(400, `${k} must be a date (yyyy-mm-dd).`);
      f[k] = raw[k];
    }
  }
  if (Array.isArray(raw.tags) && raw.tags.length) {
    const tags = raw.tags.map((t: unknown) => String(t).toUpperCase());
    if (tags.some((t: string) => !(TAGS as readonly string[]).includes(t))) throw new HttpError(400, "Unknown tag filter.");
    f.tags = tags;
  }
  f.terminatorIds = intList(raw.terminatorIds, "Terminator");
  f.reconStatusIds = intList(raw.reconStatusIds, "Reconciliation status");
  f.uploaderIds = intList(raw.uploaderIds, "Uploader");
  if (Array.isArray(raw.exceptionStatus) && raw.exceptionStatus.length) {
    if (raw.exceptionStatus.some((s: unknown) => ![...EXC_STATUSES, "none"].includes(String(s)))) throw new HttpError(400, "Unknown exception status.");
    f.exceptionStatus = raw.exceptionStatus.map(String);
  }
  f.followUp = optStr(raw.followUp, 200);
  if (raw.batchId) f.batchId = Number(raw.batchId) || undefined;
  f.onlyExceptions = !!raw.onlyExceptions;
  f.includeSuperseded = !!raw.includeSuperseded;
  f.outstandingOnly = !!raw.outstandingOnly;
  f.sort = optStr(raw.sort, 30);
  return f;
}

/** Terminator data-access scope: an empty scope means all terminators. */
export function scopeBatches(w: Where, user: SessionUser, col = "b.terminator_id") {
  if (user.terminatorScope.length) w.add(`${col} = ANY(?::int[])`, user.terminatorScope);
}

/** Batch-level filters. Aliases: b = reconciliation_batches. */
export function applyBatchFilters(w: Where, f: Filters, user: SessionUser) {
  scopeBatches(w, user);
  if (!f.includeSuperseded) w.add(`b.is_current`);
  if (f.reconFrom) w.add(`b.recon_date >= ?::date`, f.reconFrom);
  if (f.reconTo) w.add(`b.recon_date <= ?::date`, f.reconTo);
  if (f.terminatorIds) w.add(`b.terminator_id = ANY(?::int[])`, f.terminatorIds);
  if (f.reconStatusIds) w.add(`b.status_id = ANY(?::int[])`, f.reconStatusIds);
  if (f.uploaderIds) w.add(`b.uploaded_by = ANY(?::int[])`, f.uploaderIds);
  if (f.batchId) w.add(`b.id = ?`, f.batchId);
}

/** Transaction + exception filters. Aliases: t = transaction_records, e = exceptions (LEFT JOIN). */
export function applyTxFilters(w: Where, f: Filters) {
  if (f.transId) w.add(`t.trans_id ILIKE ? ESCAPE '\\'`, `%${escapeLike(f.transId)}%`);
  if (f.transIds) w.add(`lower(t.trans_id) = ANY(?::text[])`, f.transIds.map((s) => s.toLowerCase()));
  if (f.transFrom) w.add(`t.trans_date >= ?::date`, f.transFrom);
  if (f.transTo) w.add(`t.trans_date <= ?::date`, f.transTo);
  if (f.tags) w.add(`t.tag = ANY(?::text[])`, f.tags);
  if (f.onlyExceptions) w.add(`e.id IS NOT NULL`);
  if (f.outstandingOnly) w.add(`e.id IS NOT NULL AND e.status <> 'closed'`);
  if (f.exceptionStatus) {
    const real = f.exceptionStatus.filter((s) => s !== "none");
    const none = f.exceptionStatus.includes("none");
    if (real.length && none) w.add(`(e.status = ANY(?::text[]) OR e.id IS NULL)`, real);
    else if (real.length) w.add(`e.status = ANY(?::text[])`, real);
    else w.add(`e.id IS NULL`);
  }
  if (f.followUp) w.add(`e.follow_up_name ILIKE ? ESCAPE '\\'`, `%${escapeLike(f.followUp)}%`);
}

export const TX_FROM = `
  FROM transaction_records t
  JOIN reconciliation_batches b ON b.id = t.batch_id
  JOIN terminators tm ON tm.id = b.terminator_id
  JOIN users up ON up.id = b.uploaded_by
  JOIN recon_statuses rs ON rs.id = b.status_id
  LEFT JOIN exceptions e ON e.transaction_id = t.id`;

export function txWhere(f: Filters, user: SessionUser): Where {
  const w = new Where();
  applyBatchFilters(w, f, user);
  applyTxFilters(w, f);
  return w;
}

export function describeFilters(f: Filters): string {
  const parts = Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== false && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? (v.length > 8 ? `${v.length} values` : v.join("|")) : v}`);
  return parts.length ? parts.join("; ") : "(none)";
}
