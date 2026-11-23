import { route } from "../lib/router";
import { one, q } from "../lib/db";
import { HttpError, json, readJson, reqStr } from "../lib/http";
import { audit, checkPassword, clearCookie, getDummyHash, hashPassword, loadUser, passwordProblem, sessionCookie } from "../lib/auth";
import { ORG_TZ, MAX_UPLOAD_BYTES } from "../lib/config";

const secure = (req: Request) => new URL(req.url).protocol === "https:";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

route("POST", "/auth/login", { public: true }, async ({ req }) => {
  const body = await readJson(req);
  const username = reqStr(body.username, "Username", 100);
  const password = reqStr(body.password, "Password", 200);
  const u = await one(
    `SELECT id, password_hash, is_active, failed_attempts, (locked_until > now()) AS locked FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  if (!u) {
    await checkPassword(password, await getDummyHash());
    await audit(null, "auth.login_failed", "user", null, { reason: "unknown user" }, username);
    throw new HttpError(401, "Invalid username or password.");
  }
  if (u.locked) throw new HttpError(429, `Account temporarily locked after repeated failed sign-ins. Try again in ${LOCK_MINUTES} minutes.`);
  const ok = await checkPassword(password, u.password_hash);
  if (!ok || !u.is_active) {
    await q(
      `UPDATE users SET failed_attempts = failed_attempts + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE id = $1`,
      [u.id, MAX_ATTEMPTS, LOCK_MINUTES],
    );
    await audit(null, "auth.login_failed", "user", u.id, { reason: ok ? "inactive account" : "bad password" }, username);
    throw new HttpError(401, "Invalid username or password.");
  }
  await q(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  const user = await loadUser(u.id);
  if (!user) throw new HttpError(401, "Invalid username or password.");
  await audit(user, "auth.login", "user", user.id);
  return json({ user }, 200, { "set-cookie": await sessionCookie(user.id, secure(req)) });
});

route("POST", "/auth/logout", {}, async ({ req, user }) => {
  await audit(user, "auth.logout", "user", user.id);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(secure(req)) });
});

route("GET", "/auth/me", {}, async ({ user }) => {
  const [terminators, statuses] = await Promise.all([
    q(`SELECT id, code, name, is_active AS "isActive" FROM terminators ORDER BY name`),
    q(`SELECT id, name, is_active AS "isActive" FROM recon_statuses ORDER BY sort_order, name`),
  ]);
  const visible = user.terminatorScope.length ? terminators.filter((t) => user.terminatorScope.includes(t.id)) : terminators;
  return json({ user, terminators: visible, statuses, timezone: ORG_TZ(), maxUploadBytes: MAX_UPLOAD_BYTES() });
});

route("POST", "/auth/change-password", {}, async ({ req, user }) => {
  const body = await readJson(req);
  const row = await one(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!row || !(await checkPassword(String(body.currentPassword ?? ""), row.password_hash))) throw new HttpError(400, "Current password is incorrect.");
  const problem = passwordProblem(body.newPassword);
  if (problem) throw new HttpError(400, problem);
  if (body.newPassword === body.currentPassword) throw new HttpError(400, "Choose a password different from the current one.");
  await q(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [user.id, await hashPassword(body.newPassword)]);
  await audit(user, "auth.password_changed", "user", user.id);
  return json({ ok: true });
});
