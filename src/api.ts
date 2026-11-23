export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: any) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("rams:unauthenticated"));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data);
  }
  return data;
}

const headers = { "content-type": "application/json", "x-requested-with": "rams" };

export const api = {
  get: (path: string) => fetch("/api" + path, { credentials: "same-origin" }).then(parse),
  post: (path: string, body: unknown = {}) =>
    fetch("/api" + path, { method: "POST", headers, credentials: "same-origin", body: JSON.stringify(body) }).then(parse),
  put: (path: string, body: unknown = {}) =>
    fetch("/api" + path, { method: "PUT", headers, credentials: "same-origin", body: JSON.stringify(body) }).then(parse),
  upload: (path: string, form: FormData) =>
    fetch("/api" + path, { method: "POST", headers: { "x-requested-with": "rams" }, credentials: "same-origin", body: form }).then(parse),
  /** POST that returns a file (Excel export) and triggers a browser download. */
  download: async (path: string, body: unknown) => {
    const res = await fetch("/api" + path, { method: "POST", headers, credentials: "same-origin", body: JSON.stringify(body) });
    if (!res.ok) await parse(res);
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export.xlsx";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
