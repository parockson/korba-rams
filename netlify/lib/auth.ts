import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { q, one } from "./db";
import { HttpError } from "./http";

export const COOKIE = "rams_session";
const SESSION_HOURS = 8;

export interface RoleInfo {
  id: number;
  name: string;
  isAuditor: boolean;
  permissions: string[];
}
export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  mustChangePassword: boolean;
  terminatorScope: number[];
  roles: RoleInfo[];
  permissions: string[];
}

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new HttpError(500, "JWT_SECRET must be set to a random string of at least 32 characters.");
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
// compared against when the username does not exist, so timing does not reveal valid usernames
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= bcrypt.hash("rams-dummy-password", 11));

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and at least one number.";
  return null;
}

export async function sessionCookie(userId: number, secure: boolean) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;

function cookie(req: Request, name: string): string | null {
  const h = req.headers.get("cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function loadUser(id: number): Promise<SessionUser | null> {
  const u = await one(
    `SELECT u.id, u.username, u.full_name, u.email, u.must_change_password, u.terminator_scope, u.is_active,
            COALESCE(json_agg(json_build_object(
              'id', r.id, 'name', r.name, 'isAuditor', r.is_auditor,
              'permissions', (SELECT COALESCE(json_agg(rp.permission_key), '[]'::json) FROM role_permissions rp WHERE rp.role_id = r.id)
            ) ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id`,
    [id],
  );
  if (!u || !u.is_active) return null;
  const roles: RoleInfo[] = u.roles;
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    mustChangePassword: u.must_change_password,
    terminatorScope: u.terminator_scope ?? [],
    roles,
    permissions: [...new Set(roles.flatMap((r) => r.permissions))],
  };
}

export async function authenticate(req: Request): Promise<SessionUser | null> {
  const token = cookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    return Number.isInteger(id) ? await loadUser(id) : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

export const can = (u: SessionUser, perm: string) => u.permissions.includes(perm);

/**
 * Segregation of duties: close/reopen are honoured only through a role that is flagged as an auditor
 * role AND carries the permission. Returns that role so the action can be recorded "as" that role.
 */
export const auditorRole = (u: SessionUser, perm: "exceptions.close" | "exceptions.reopen") =>
  u.roles.find((r) => r.isAuditor && r.permissions.includes(perm));

/** The role name to record against an action that needs `perm`. */
export const roleFor = (u: SessionUser, perm?: string) =>
  (perm ? u.roles.find((r) => r.permissions.includes(perm)) : undefined)?.name ?? u.roles.map((r) => r.name).join(", ") ?? "";

export async function audit(
  u: Pick<SessionUser, "id" | "username"> & { roles?: RoleInfo[] } | null,
  action: string,
  entityType: string | null,
  entityId: string | number | null,
  detail: Record<string, unknown> = {},
  username?: string,
) {
  await q(
    `INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [u?.id ?? null, u?.username ?? username ?? null, u?.roles?.map((r) => r.name).join(", ") ?? null, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(detail)],
  );
}
