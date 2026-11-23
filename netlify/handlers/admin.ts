import { route } from "../lib/router";
import { one, q } from "../lib/db";
import { HttpError, intList, json, optStr, readJson, reqInt, reqStr } from "../lib/http";
import { audit, hashPassword, passwordProblem } from "../lib/auth";
import { PERMISSIONS } from "../lib/schema";

const CLOSURE_PERMS = ["exceptions.close", "exceptions.reopen"];

/* ---------------- users ---------------- */
route("GET", "/users", { perm: ["users.manage", "exceptions.assign", "recon.view"] }, async ({ user }) => {
  const manage = user.permissions.includes("users.manage");
  const rows = await q(
    `SELECT u.id, u.username, u.full_name AS "fullName", u.email, u.is_active AS "isActive",
            u.must_change_password AS "mustChangePassword", u.terminator_scope AS "terminatorScope",
            u.last_login_at AS "lastLoginAt",
            COALESCE((SELECT json_agg(ur.role_id) FROM user_roles ur WHERE ur.user_id = u.id), '[]'::json) AS "roleIds",
            COALESCE((SELECT json_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]'::json) AS "roleNames"
       FROM users u ORDER BY u.full_name`,
  );
  // non-admins only get what they need to pick an uploader / follow-up account
  return json({ users: manage ? rows : rows.filter((u) => u.isActive).map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, isActive: u.isActive, roleNames: u.roleNames })) });
});

route("POST", "/users", { perm: "users.manage" }, async ({ req, user }) => {
  const b = await readJson(req);
  const username = reqStr(b.username, "Username", 60);
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(username)) throw new HttpError(400, "Username may contain letters, numbers, dot, dash and underscore (3-60 characters).");
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const roleIds = intList(b.roleIds, "Role") ?? [];
  const scope = intList(b.terminatorScope, "Terminator") ?? [];
  const created = await one(
    `WITH u AS (
       INSERT INTO users (username, full_name, email, password_hash, terminator_scope)
       VALUES ($1,$2,$3,$4,$5::int[]) ON CONFLICT DO NOTHING RETURNING id),
     ur AS (INSERT INTO user_roles (user_id, role_id) SELECT u.id, r FROM u, unnest($6::int[]) r RETURNING 1)
     SELECT id FROM u`,
    [username, reqStr(b.fullName, "Full name", 120), optStr(b.email, 200) ?? null, await hashPassword(b.password), scope, roleIds],
  );
  if (!created) throw new HttpError(409, "That username is already in use.");
  await audit(user, "user.created", "user", created.id, { username, roleIds });
  return json({ id: created.id }, 201);
});

route("PUT", "/users/:id", { perm: "users.manage" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "User");
  const b = await readJson(req);
  const before = await one(`SELECT full_name, email, is_active, terminator_scope FROM users WHERE id = $1`, [id]);
  if (!before) throw new HttpError(404, "User not found.");
  if (id === user.id && b.isActive === false) throw new HttpError(400, "You cannot deactivate your own account.");
  const roleIds = intList(b.roleIds, "Role");
  if (roleIds && id === user.id && !roleIds.some((r) => user.roles.some((x) => x.id === r && x.permissions.includes("users.manage")))) {
    throw new HttpError(400, "You cannot remove your own user-administration access.");
  }
  const scope = intList(b.terminatorScope, "Terminator");
  const row = await one(
    `WITH u AS (
       UPDATE users SET full_name = COALESCE($2, full_name), email = CASE WHEN $3::boolean THEN $4 ELSE email END,
              is_active = COALESCE($5::boolean, is_active),
              terminator_scope = CASE WHEN $6::boolean THEN $7::int[] ELSE terminator_scope END
        WHERE id = $1 RETURNING id),
     del AS (DELETE FROM user_roles WHERE $8::boolean AND user_id = $1 AND NOT (role_id = ANY($9::int[])) RETURNING 1),
     ins AS (INSERT INTO user_roles (user_id, role_id) SELECT $1, r FROM unnest($9::int[]) r WHERE $8::boolean ON CONFLICT DO NOTHING RETURNING 1)
     SELECT id FROM u`,
    [id, optStr(b.fullName, 120) ?? null, "email" in b, optStr(b.email, 200) ?? null, typeof b.isActive === "boolean" ? b.isActive : null,
     b.terminatorScope !== undefined, scope ?? [], roleIds !== undefined, roleIds ?? []],
  );
  if (!row) throw new HttpError(404, "User not found.");
  await audit(user, "user.updated", "user", id, { before, after: { fullName: b.fullName, email: b.email, isActive: b.isActive, roleIds, terminatorScope: scope } });
  return json({ ok: true });
});

route("POST", "/users/:id/reset-password", { perm: "users.manage" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "User");
  const b = await readJson(req);
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const r = await one(`UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id`, [id, await hashPassword(b.password)]);
  if (!r) throw new HttpError(404, "User not found.");
  await audit(user, "user.password_reset", "user", id);
  return json({ ok: true });
});

/* ---------------- roles & permissions ---------------- */
route("GET", "/roles", { perm: ["roles.manage", "users.manage"] }, async () => {
  const [roles, permissions] = await Promise.all([
    q(`SELECT r.id, r.name, r.description, r.is_auditor AS "isAuditor", r.is_system AS "isSystem",
              COALESCE((SELECT json_agg(rp.permission_key ORDER BY rp.permission_key) FROM role_permissions rp WHERE rp.role_id = r.id), '[]'::json) AS permissions,
              (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id) AS "userCount"
         FROM roles r ORDER BY r.name`),
    q(`SELECT key, group_name AS "group", description FROM permissions ORDER BY group_name, key`),
  ]);
  return json({ roles, permissions });
});

function checkRolePayload(b: any, name: string) {
  const known = new Set(PERMISSIONS.map((p) => p[0]));
  const perms: string[] = Array.isArray(b.permissions) ? [...new Set<string>(b.permissions.map(String))] : [];
  if (perms.some((p) => !known.has(p))) throw new HttpError(400, "Unknown permission in request.");
  const isAuditor = !!b.isAuditor;
  // Segregation of duties is enforced here and again at the point of use.
  if (!isAuditor && perms.some((p) => CLOSURE_PERMS.includes(p))) {
    throw new HttpError(400, `Only an Internal Auditor role may hold closure permissions. Mark "${name}" as an auditor role first, or remove the close/reopen permissions.`);
  }
  return { perms, isAuditor };
}

route("POST", "/roles", { perm: "roles.manage" }, async ({ req, user }) => {
  const b = await readJson(req);
  const name = reqStr(b.name, "Role name", 80);
  const { perms, isAuditor } = checkRolePayload(b, name);
  const r = await one(
    `WITH r AS (INSERT INTO roles (name, description, is_auditor) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id),
          p AS (INSERT INTO role_permissions (role_id, permission_key) SELECT r.id, k FROM r, unnest($4::text[]) k RETURNING 1)
     SELECT id FROM r`,
    [name, optStr(b.description, 300) ?? "", isAuditor, perms],
  );
  if (!r) throw new HttpError(409, "A role with that name already exists.");
  await audit(user, "role.created", "role", r.id, { name, isAuditor, permissions: perms });
  return json({ id: r.id }, 201);
});

route("PUT", "/roles/:id", { perm: "roles.manage" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Role");
  const b = await readJson(req);
  const cur = await one(`SELECT name, is_system, is_auditor, (SELECT COALESCE(json_agg(permission_key), '[]'::json) FROM role_permissions WHERE role_id = roles.id) AS permissions FROM roles WHERE id = $1`, [id]);
  if (!cur) throw new HttpError(404, "Role not found.");
  const name = optStr(b.name, 80) ?? cur.name;
  const { perms, isAuditor } = checkRolePayload({ ...b, isAuditor: b.isAuditor ?? cur.is_auditor }, name);
  // administrators must not lock themselves out of role management
  const mine = user.roles.find((r) => r.id === id);
  if (mine && mine.permissions.includes("roles.manage") && !perms.includes("roles.manage") && !user.roles.some((r) => r.id !== id && r.permissions.includes("roles.manage"))) {
    throw new HttpError(400, "You cannot remove role-management access from your own only role.");
  }
  await q(
    `WITH r AS (UPDATE roles SET name = $2, description = COALESCE($3, description), is_auditor = $4 WHERE id = $1 RETURNING id),
          del AS (DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_key = ANY($5::text[])) RETURNING 1),
          ins AS (INSERT INTO role_permissions (role_id, permission_key) SELECT $1, k FROM unnest($5::text[]) k ON CONFLICT DO NOTHING RETURNING 1)
     SELECT id FROM r`,
    [id, name, optStr(b.description, 300) ?? null, isAuditor, perms],
  );
  await audit(user, "role.updated", "role", id, { before: { name: cur.name, isAuditor: cur.is_auditor, permissions: cur.permissions }, after: { name, isAuditor, permissions: perms } });
  return json({ ok: true });
});

/* ---------------- terminators ---------------- */
route("GET", "/terminators", { perm: "terminators.manage" }, async () =>
  json({
    terminators: await q(
      `SELECT t.id, t.code, t.name, t.is_active AS "isActive",
              (SELECT count(*)::int FROM reconciliation_batches b WHERE b.terminator_id = t.id) AS "batchCount"
         FROM terminators t ORDER BY t.name`,
    ),
  }),
);

route("POST", "/terminators", { perm: "terminators.manage" }, async ({ req, user }) => {
  const b = await readJson(req);
  const name = reqStr(b.name, "Display name", 100);
  const code = reqStr(b.code, "Identifier", 40).toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new HttpError(400, "Identifier may contain letters, numbers, dash and underscore.");
  const r = await one(`INSERT INTO terminators (code, name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [code, name]);
  if (!r) throw new HttpError(409, "A terminator with that identifier already exists.");
  await audit(user, "terminator.created", "terminator", r.id, { code, name });
  return json({ id: r.id }, 201);
});

route("PUT", "/terminators/:id", { perm: "terminators.manage" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Terminator");
  const b = await readJson(req);
  const before = await one(`SELECT name, is_active FROM terminators WHERE id = $1`, [id]);
  if (!before) throw new HttpError(404, "Terminator not found.");
  await q(`UPDATE terminators SET name = COALESCE($2, name), is_active = COALESCE($3::boolean, is_active) WHERE id = $1`, [
    id, optStr(b.name, 100) ?? null, typeof b.isActive === "boolean" ? b.isActive : null,
  ]);
  await audit(user, "terminator.updated", "terminator", id, { before, after: { name: b.name, isActive: b.isActive } });
  return json({ ok: true });
});

/* ---------------- reconciliation status options ---------------- */
route("GET", "/recon-statuses", { perm: "settings.manage" }, async () =>
  json({ statuses: await q(`SELECT id, name, sort_order AS "sortOrder", is_active AS "isActive" FROM recon_statuses ORDER BY sort_order, name`) }),
);
route("POST", "/recon-statuses", { perm: "settings.manage" }, async ({ req, user }) => {
  const b = await readJson(req);
  const name = reqStr(b.name, "Status name", 60);
  const r = await one(
    `INSERT INTO recon_statuses (name, sort_order) VALUES ($1, COALESCE((SELECT max(sort_order) FROM recon_statuses), 0) + 1) ON CONFLICT DO NOTHING RETURNING id`,
    [name],
  );
  if (!r) throw new HttpError(409, "That status already exists.");
  await audit(user, "recon_status.created", "recon_status", r.id, { name });
  return json({ id: r.id }, 201);
});
route("PUT", "/recon-statuses/:id", { perm: "settings.manage" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Status");
  const b = await readJson(req);
  const r = await one(`UPDATE recon_statuses SET name = COALESCE($2, name), is_active = COALESCE($3::boolean, is_active) WHERE id = $1 RETURNING id`, [
    id, optStr(b.name, 60) ?? null, typeof b.isActive === "boolean" ? b.isActive : null,
  ]);
  if (!r) throw new HttpError(404, "Status not found.");
  await audit(user, "recon_status.updated", "recon_status", id, { name: b.name, isActive: b.isActive });
  return json({ ok: true });
});
