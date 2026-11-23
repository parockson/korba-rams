export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    const v = await req.json();
    return (v && typeof v === "object" ? v : {}) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

/** Optional trimmed string with a length cap. Returns undefined when blank. */
export function optStr(v: unknown, max = 500): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (s.length > max) throw new HttpError(400, `Text is too long (maximum ${max} characters).`);
  return s;
}

export function reqStr(v: unknown, label: string, max = 500): string {
  const s = optStr(v, max);
  if (!s) throw new HttpError(400, `${label} is required.`);
  return s;
}

export function reqInt(v: unknown, label: string): number {
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v ?? "")) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(400, `${label} is invalid.`);
  return n;
}

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

export function intList(v: unknown, label: string): number[] | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (!Array.isArray(v)) throw new HttpError(400, `${label} must be a list.`);
  const out = v.map((x) => reqInt(x, label));
  return out.length ? out : undefined;
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
