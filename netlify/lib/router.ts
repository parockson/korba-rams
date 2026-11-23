import { authenticate, can, type SessionUser } from "./auth";
import { HttpError, json } from "./http";

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  user: SessionUser;
}
export type Handler = (c: Ctx) => Promise<Response>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  isPublic: boolean;
  perms: string[]; // any-of; empty = any authenticated user
  handler: Handler;
}
const routes: Route[] = [];

export function route(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { public?: boolean; perm?: string | string[] },
  handler: Handler,
) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, re, keys, isPublic: !!opts.public, perms: [opts.perm ?? []].flat(), handler });
}

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  let matched: { r: Route; params: Record<string, string> } | undefined;
  let pathExists = false;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathExists = true;
    if (r.method !== req.method) continue;
    matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    break;
  }
  if (!matched) throw new HttpError(pathExists ? 405 : 404, pathExists ? "Method not allowed." : "Not found.");
  const { r, params } = matched;
  // CSRF defence in depth (cookie is SameSite=Strict): state-changing calls must carry a custom header
  if (req.method !== "GET" && req.headers.get("x-requested-with") !== "rams") throw new HttpError(403, "Missing request header.");
  let user = null as SessionUser | null;
  if (!r.isPublic) {
    user = await authenticate(req);
    if (!user) throw new HttpError(401, "Please sign in.", "UNAUTHENTICATED");
    // deny by default: a password change is the only thing allowed while a reset is pending
    if (user.mustChangePassword && path !== "/auth/change-password" && path !== "/auth/me" && path !== "/auth/logout") {
      throw new HttpError(403, "You must change your password before continuing.", "PASSWORD_CHANGE_REQUIRED");
    }
    if (r.perms.length && !r.perms.some((p) => can(user!, p))) throw new HttpError(403, "You do not have permission to do that.", "FORBIDDEN");
  }
  const res = await r.handler({ req, url, params, user: user as SessionUser });
  return res ?? json({ ok: true });
}
