import * as XLSX from "xlsx";
import { HttpError } from "./http";
import { parseCsv } from "./validate";

export const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];

/** Extension AND content must agree (a renamed .exe or .html is refused). */
export function parseUpload(filename: string, buf: Uint8Array): { rows: unknown[][]; warnings: string[] } {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (!ALLOWED_EXT.includes(ext)) throw new HttpError(400, "Only .xlsx, .xls and .csv files are accepted.");
  if (buf.length === 0) throw new HttpError(400, "The file is empty.");
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  const warnings: string[] = [];
  if (ext === ".csv") {
    if (isZip || isOle || buf.subarray(0, 4096).includes(0)) throw new HttpError(400, "This file is not a text CSV file.");
    return { rows: parseCsv(new TextDecoder("utf-8").decode(buf)), warnings };
  }
  if ((ext === ".xlsx" && !isZip) || (ext === ".xls" && !isOle && !isZip)) {
    throw new HttpError(400, `The file content does not match its ${ext} extension.`);
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellFormula: false, cellHTML: false });
  } catch {
    throw new HttpError(400, "The spreadsheet could not be read. It may be corrupt or password protected.");
  }
  if (!wb.SheetNames.length) throw new HttpError(400, "The workbook contains no sheets.");
  if (wb.SheetNames.length > 1) warnings.push(`The workbook has ${wb.SheetNames.length} sheets; only the first ("${wb.SheetNames[0]}") is imported.`);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: true });
  return { rows, warnings };
}
