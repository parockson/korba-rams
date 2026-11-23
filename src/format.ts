const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyy-mm-dd → 15-Nov-2026 (string maths only, so no timezone can shift a calendar date). */
export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${+m[3]}-${MON[+m[2] - 1]}-${m[1]}` : d;
}

let tz = "UTC";
export const setTimezone = (z: string) => (tz = z);

export function fmtDateTime(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
  } catch {
    return d.toISOString();
  }
}

export const fmtNum = (n?: number | null) => (n === null || n === undefined ? "—" : n.toLocaleString("en-GB"));
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const pct = (n?: number | null) => (n === null || n === undefined ? "—" : `${n.toFixed(n % 1 ? 2 : 0)}%`);
