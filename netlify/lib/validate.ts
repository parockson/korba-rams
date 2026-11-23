// Pure validation of an uploaded transaction table. No I/O, fully unit-testable.
// Shared by the preview and the submit endpoints (the server always re-validates).

export const TAGS = ["P2S", "P2F", "F2S", "S2F"] as const;
export type Tag = (typeof TAGS)[number];
export const EXCEPTION_TAGS: Tag[] = ["F2S", "S2F"];

export interface AcceptedRow {
  rowNumber: number; // 1-based spreadsheet row (header is row 1)
  transDate: string; // ISO yyyy-mm-dd
  transId: string;
  tag: Tag;
}

export interface RejectedRow {
  rowNumber: number;
  transDate: string;
  transId: string;
  tag: string;
  errors: string[];
}

export interface Summary {
  total: number;
  p2s: number;
  p2f: number;
  f2s: number;
  s2f: number;
  exceptions: number;
  minDate: string | null;
  maxDate: string | null;
  exceptionPct: number;
  reconciles: boolean;
}

export interface ValidationResult {
  fatal: string[]; // file-level problems: nothing can be imported
  warnings: string[];
  ignoredColumns: string[];
  accepted: AcceptedRow[];
  rejected: RejectedRow[];
  summary: Summary;
}

const REQUIRED = { "trans date": "transDate", "trans id": "transId", tag: "tag" } as const;

export const normHeader = (h: unknown) =>
  String(h ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse a cell into ISO yyyy-mm-dd. Day-first is assumed for dd/mm/yyyy. Returns null if unparseable. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return validYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number") {
    // Excel serial date (1900 system)
    if (Number.isInteger(v) && v >= 19900101 && v <= 21001231) {
      return validYmd(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
    }
    if (!isFinite(v) || v < 20000 || v > 80000) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000;
    const dt = new Date(ms);
    return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) return validYmd(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/))) return validYmd(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{4})$/))) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? validYmd(+m[3], mon, +m[1]) : null;
  }
  if (/^\d{8}$/.test(s)) return validYmd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return null;
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return parseDate(v) ?? "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("fullwide", { useGrouping: false }) : String(v);
  return String(v);
};

/**
 * Validate a table of raw cell values. rows[0] is the header row.
 */
export function validateTable(rows: unknown[][], opts: { maxRows?: number } = {}): ValidationResult {
  const result: ValidationResult = {
    fatal: [],
    warnings: [],
    ignoredColumns: [],
    accepted: [],
    rejected: [],
    summary: emptySummary(),
  };
  if (!rows.length) {
    result.fatal.push("The file is empty.");
    return result;
  }
  const header = rows[0];
  const idx: Partial<Record<(typeof REQUIRED)[keyof typeof REQUIRED], number>> = {};
  const seenHeaders = new Map<string, number>();
  header.forEach((h, i) => {
    const key = normHeader(h);
    if (!key) return;
    if (seenHeaders.has(key)) {
      result.fatal.push(`Column "${String(h).trim()}" appears more than once in the header row.`);
      return;
    }
    seenHeaders.set(key, i);
    const field = (REQUIRED as Record<string, keyof typeof idx>)[key];
    if (field) idx[field] = i;
    else result.ignoredColumns.push(String(h).trim());
  });
  const missing = Object.entries(REQUIRED)
    .filter(([, f]) => idx[f as keyof typeof idx] === undefined)
    .map(([label]) => label.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Id", "ID"));
  if (missing.length) {
    result.fatal.push(`Missing required column(s): ${missing.join(", ")}. The file must contain Trans Date, Trans ID and Tag.`);
  }
  if (result.ignoredColumns.length) {
    result.warnings.push(
      `Extra column(s) will be ignored: ${result.ignoredColumns.join(", ")}. (Recon Date is generated by RAMS and must not be in the file.)`,
    );
  }
  const body = rows.slice(1);
  if (opts.maxRows && body.length > opts.maxRows) {
    result.fatal.push(`The file has ${body.length} data rows; the maximum allowed is ${opts.maxRows}.`);
  }
  if (result.fatal.length) return result;

  const firstSeen = new Map<string, number>();
  body.forEach((row, i) => {
    const rowNumber = i + 2;
    const rawDate = row[idx.transDate!];
    const rawId = row[idx.transId!];
    const rawTag = row[idx.tag!];
    const isBlank = [rawDate, rawId, rawTag].every((c) => cellText(c).trim() === "");
    if (isBlank) return; // wholly blank lines are skipped, not counted as errors
    const errors: string[] = [];
    const transId = cellText(rawId).trim();
    const tag = cellText(rawTag).trim().toUpperCase();
    const transDate = parseDate(rawDate);
    if (!transId) errors.push("Trans ID is blank");
    if (transDate === null) errors.push(cellText(rawDate).trim() ? `Trans Date "${cellText(rawDate).trim()}" is not a valid date` : "Trans Date is blank");
    if (!(TAGS as readonly string[]).includes(tag)) {
      errors.push(tag ? `Tag "${cellText(rawTag).trim()}" is not valid (allowed: P2S, P2F, F2S, S2F)` : "Tag is blank");
    }
    if (transId) {
      const key = transId.toLowerCase();
      const first = firstSeen.get(key);
      if (first !== undefined) errors.push(`Duplicate Trans ID (first seen on row ${first})`);
      else firstSeen.set(key, rowNumber);
    }
    if (errors.length) {
      result.rejected.push({
        rowNumber,
        transDate: transDate ?? cellText(rawDate).trim(),
        transId,
        tag: cellText(rawTag).trim(),
        errors,
      });
    } else {
      result.accepted.push({ rowNumber, transDate: transDate!, transId, tag: tag as Tag });
    }
  });
  // A Trans ID whose first occurrence was itself rejected for another reason still blocks later copies;
  // that is intentional - every affected row is listed rather than silently dropped.
  result.summary = summarise(result.accepted);
  if (!result.accepted.length) result.warnings.push("No valid rows were found in this file.");
  if (!result.summary.reconciles) result.fatal.push("Tag counts do not reconcile to the accepted row count.");
  return result;
}

export function emptySummary(): Summary {
  return { total: 0, p2s: 0, p2f: 0, f2s: 0, s2f: 0, exceptions: 0, minDate: null, maxDate: null, exceptionPct: 0, reconciles: true };
}

export function summarise(rows: AcceptedRow[]): Summary {
  const s = emptySummary();
  s.total = rows.length;
  for (const r of rows) {
    if (r.tag === "P2S") s.p2s++;
    else if (r.tag === "P2F") s.p2f++;
    else if (r.tag === "F2S") s.f2s++;
    else if (r.tag === "S2F") s.s2f++;
    if (!s.minDate || r.transDate < s.minDate) s.minDate = r.transDate;
    if (!s.maxDate || r.transDate > s.maxDate) s.maxDate = r.transDate;
  }
  s.exceptions = s.f2s + s.s2f;
  s.exceptionPct = s.total ? Math.round((s.exceptions / s.total) * 100000) / 1000 : 0;
  s.reconciles = s.p2s + s.p2f + s.f2s + s.s2f === s.total;
  return s;
}

/** Minimal RFC 4180 CSV parser. Everything stays a string so leading zeros in IDs survive. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!delimiter) {
    const head = text.split(/\r?\n/, 1)[0] ?? "";
    delimiter = [",", ";", "\t"].map((d) => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
