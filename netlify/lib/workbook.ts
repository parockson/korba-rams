import * as XLSX from "xlsx";

export interface Sheet {
  name: string;
  rows: Record<string, unknown>[];
  columns?: string[]; // keeps headers visible when there are no rows
}

export function buildWorkbook(sheets: Sheet[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const cols = s.columns ?? (s.rows[0] ? Object.keys(s.rows[0]) : ["(no records)"]);
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: cols });
    ws["!cols"] = cols.map((c) => {
      const longest = s.rows.slice(0, 500).reduce((m, r) => Math.max(m, String(r[c] ?? "").length), c.length);
      return { wch: Math.min(Math.max(longest + 2, 10), 60) };
    });
    ws["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}
