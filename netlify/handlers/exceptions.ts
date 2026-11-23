import { route } from "../lib/router";
import { one } from "../lib/db";
import { HttpError, json, optStr, readJson, reqInt, reqStr } from "../lib/http";
import { auditorRole, roleFor, type SessionUser } from "../lib/auth";
import { loadException } from "./search";
import { scopeBatches, Where } from "../lib/filters";

/** Load an exception the user may see (terminator data scope applies). */
async function getAccessible(user: SessionUser, id: number) {
  const w = new Where().add(`e.id = ?`, id);
  scopeBatches(w, user);
  const e = await one(
    `SELECT e.id::int AS id, e.status, e.follow_up_name, e.issue_description FROM exceptions e JOIN reconciliation_batches b ON b.id = e.batch_id ${w.sql}`,
    w.params,
  );
  if (!e) throw new HttpError(404, "Exception not found.");
  return e as { id: number; status: string; follow_up_name: string | null; issue_description: string | null };
}

const done = async (id: number) => json({ exception: await loadException(id) });
const stateError = (cur: string) =>
  new HttpError(409, `This exception is now "${cur.replace(/_/g, " ")}", so that action is not available. Reload to see the latest state.`, "STATE_CONFLICT");

/* ---- comments (append-only) ---- */
route("POST", "/exceptions/:id/comments", { perm: "exceptions.comment" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const body = reqStr((await readJson(req)).body, "Comment", 4000);
  const cur = await getAccessible(user, id);
  if (cur.status === "closed") throw new HttpError(409, "A closed exception is read-only. An auditor must reopen it before further comments.", "STATE_CONFLICT");
  const role = roleFor(user, "exceptions.comment");
  const r = await one(
    `WITH e AS (UPDATE exceptions SET last_activity_at = now() WHERE id = $1 AND status <> 'closed' RETURNING id),
          c AS (INSERT INTO exception_comments (exception_id, author_id, author_name, author_role, body)
                SELECT e.id, $2::int, $3::text, $4::text, $5::text FROM e RETURNING id),
          ev AS (INSERT INTO exception_events (exception_id, event_type, actor_id, actor_name, actor_role, detail)
                 SELECT e.id, 'comment', $2::int, $3::text, $4::text, jsonb_build_object('commentId', (SELECT id FROM c)) FROM e RETURNING id),
          aud AS (INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
                  SELECT $2::int, $6::text, $4::text, 'exception.comment', 'exception', e.id::text, jsonb_build_object('length', length($5::text)) FROM e RETURNING id)
     SELECT id FROM e`,
    [id, user.id, user.fullName, role, body, user.username],
  );
  if (!r) throw stateError("closed");
  return done(id);
});

/* ---- issue description ---- */
route("POST", "/exceptions/:id/issue", { perm: ["exceptions.comment", "exceptions.resolve"] }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const text = reqStr((await readJson(req)).description, "Issue description", 2000);
  const cur = await getAccessible(user, id);
  if (cur.status === "closed") throw new HttpError(409, "A closed exception is read-only.", "STATE_CONFLICT");
  const role = roleFor(user, "exceptions.comment");
  await one(
    `WITH e AS (UPDATE exceptions SET issue_description = $2::text, last_activity_at = now() WHERE id = $1 AND status <> 'closed' RETURNING id),
          ev AS (INSERT INTO exception_events (exception_id, event_type, actor_id, actor_name, actor_role, detail)
                 SELECT e.id, 'issue_updated', $3::int, $4::text, $5::text, jsonb_build_object('previous', $6::text, 'new', $2::text) FROM e RETURNING id),
          aud AS (INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
                  SELECT $3::int, $7::text, $5::text, 'exception.issue_updated', 'exception', e.id::text, jsonb_build_object('previous', $6::text, 'new', $2::text) FROM e RETURNING id)
     SELECT id FROM e`,
    [id, text, user.id, user.fullName, role, cur.issue_description, user.username],
  );
  return done(id);
});

/* ---- follow-up assignment (free text, reusable suggestions, history kept) ---- */
route("POST", "/exceptions/:id/assign", { perm: "exceptions.assign" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const b = await readJson(req);
  const name = reqStr(b.name, "Follow-up person", 120);
  const linkedUserId = b.userId ? reqInt(b.userId, "User") : null;
  const cur = await getAccessible(user, id);
  if (cur.status === "closed") throw new HttpError(409, "A closed exception cannot be reassigned. Reopen it first.", "STATE_CONFLICT");
  if (cur.follow_up_name === name) throw new HttpError(400, "That person is already the follow-up owner.");
  if (linkedUserId && !(await one(`SELECT 1 AS x FROM users WHERE id = $1 AND is_active`, [linkedUserId]))) throw new HttpError(400, "Linked user not found.");
  const role = roleFor(user, "exceptions.assign");
  const r = await one(
    `WITH c AS (
       INSERT INTO follow_up_contacts (name, user_id, use_count) VALUES ($2::text, $3::int, 1)
       ON CONFLICT (lower(name)) DO UPDATE SET use_count = follow_up_contacts.use_count + 1,
              user_id = COALESCE(EXCLUDED.user_id, follow_up_contacts.user_id)
       RETURNING id),
     e AS (UPDATE exceptions SET follow_up_name = $2::text, follow_up_contact_id = (SELECT id FROM c), last_activity_at = now()
            WHERE id = $1 AND status <> 'closed' RETURNING id),
     a AS (INSERT INTO exception_assignments (exception_id, follow_up_name, contact_id, user_id, previous_name, assigned_by)
           SELECT e.id, $2::text, (SELECT id FROM c), $3::int, $4::text, $5::int FROM e RETURNING id),
     ev AS (INSERT INTO exception_events (exception_id, event_type, actor_id, actor_name, actor_role, detail)
            SELECT e.id, CASE WHEN $4::text IS NULL THEN 'assigned' ELSE 'reassigned' END, $5::int, $6::text, $7::text,
                   jsonb_build_object('to', $2::text, 'from', $4::text, 'linkedUserId', $3::int) FROM e RETURNING id),
     aud AS (INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
             SELECT $5::int, $8::text, $7::text, 'exception.assigned', 'exception', e.id::text,
                    jsonb_build_object('to', $2::text, 'from', $4::text) FROM e RETURNING id)
     SELECT id FROM e`,
    [id, name, linkedUserId, cur.follow_up_name, user.id, user.fullName, role, user.username],
  );
  if (!r) throw stateError("closed");
  return done(id);
});

/* ---- lifecycle transitions ---- */
interface Transition {
  id: number;
  user: SessionUser;
  role: string;
  from: string[];
  to: string;
  event: string;
  note?: string | null;
  resolution?: { explanation: string; evidence: string | null };
  closureAction?: "closed" | "returned" | "reopened";
}

async function transition(t: Transition) {
  const r = await one(
    `WITH e AS (
       UPDATE exceptions SET status = $2::text, last_activity_at = now(),
              closed_by_name = CASE WHEN $2 = 'closed' THEN $4::text WHEN $2 = 'reopened' THEN NULL ELSE closed_by_name END,
              closed_by_role = CASE WHEN $2 = 'closed' THEN $5::text WHEN $2 = 'reopened' THEN NULL ELSE closed_by_role END,
              closed_at      = CASE WHEN $2 = 'closed' THEN now()    WHEN $2 = 'reopened' THEN NULL ELSE closed_at END,
              closure_note   = CASE WHEN $2 = 'closed' THEN $6::text WHEN $2 = 'reopened' THEN NULL ELSE closure_note END
        WHERE id = $1 AND status = ANY($3::text[]) RETURNING id),
     res AS (INSERT INTO exception_resolutions (exception_id, explanation, evidence_reference, submitted_by, submitted_by_name, submitted_role)
             SELECT e.id, $7::text, $8::text, $9::int, $4::text, $5::text FROM e WHERE $7::text IS NOT NULL RETURNING id),
     clo AS (INSERT INTO exception_closures (exception_id, action, note, user_id, user_name, role_name)
             SELECT e.id, $10::text, $6::text, $9::int, $4::text, $5::text FROM e WHERE $10::text IS NOT NULL RETURNING id),
     ev AS (INSERT INTO exception_events (exception_id, event_type, actor_id, actor_name, actor_role, detail)
            SELECT e.id, $11::text, $9::int, $4::text, $5::text, jsonb_build_object('to', $2::text, 'note', COALESCE($6::text, $7::text)) FROM e RETURNING id),
     aud AS (INSERT INTO audit_logs (user_id, username, role_name, action, entity_type, entity_id, detail)
             SELECT $9::int, $12::text, $5::text, 'exception.' || $11::text, 'exception', e.id::text,
                    jsonb_build_object('to', $2::text, 'note', COALESCE($6::text, $7::text)) FROM e RETURNING id)
     SELECT id FROM e`,
    [t.id, t.to, t.from, t.user.fullName, t.role, t.note ?? null, t.resolution?.explanation ?? null, t.resolution?.evidence ?? null,
     t.user.id, t.closureAction ?? null, t.event, t.user.username],
  );
  return !!r;
}

route("POST", "/exceptions/:id/start", { perm: "exceptions.resolve" }, async ({ user, params }) => {
  const id = reqInt(params.id, "Exception");
  const cur = await getAccessible(user, id);
  if (!(await transition({ id, user, role: roleFor(user, "exceptions.resolve"), from: ["open", "reopened"], to: "investigating", event: "investigation_started" }))) throw stateError(cur.status);
  return done(id);
});

route("POST", "/exceptions/:id/resolve", { perm: "exceptions.resolve" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const b = await readJson(req);
  const explanation = reqStr(b.explanation, "Resolution explanation", 4000);
  const evidence = optStr(b.evidence, 500) ?? null;
  const cur = await getAccessible(user, id);
  if (!(await transition({
    id, user, role: roleFor(user, "exceptions.resolve"), from: ["open", "investigating", "reopened"],
    to: "resolution_submitted", event: "resolution_submitted", resolution: { explanation, evidence },
  }))) throw stateError(cur.status);
  return done(id);
});

// --- auditor-only actions: honoured only through an auditor-flagged role holding the permission ---
function requireAuditor(user: SessionUser, perm: "exceptions.close" | "exceptions.reopen") {
  const role = auditorRole(user, perm);
  if (!role) {
    throw new HttpError(403, "Only an Internal Auditor may close, return or reopen an exception. Reconciliation officers cannot do this.", "SEGREGATION_OF_DUTIES");
  }
  return role.name;
}

route("POST", "/exceptions/:id/close", { perm: "exceptions.close" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const note = reqStr((await readJson(req)).note, "Closure note", 4000);
  const role = requireAuditor(user, "exceptions.close");
  const cur = await getAccessible(user, id);
  if (!(await transition({ id, user, role, from: ["resolution_submitted"], to: "closed", event: "closed", note, closureAction: "closed" }))) {
    throw cur.status === "closed" ? stateError("closed") : new HttpError(409, "An exception can only be closed after a resolution has been submitted and reviewed.", "STATE_CONFLICT");
  }
  return done(id);
});

route("POST", "/exceptions/:id/return", { perm: "exceptions.close" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const note = reqStr((await readJson(req)).note, "Reason for returning the case", 4000);
  const role = requireAuditor(user, "exceptions.close");
  const cur = await getAccessible(user, id);
  if (!(await transition({ id, user, role, from: ["resolution_submitted"], to: "investigating", event: "returned_for_rework", note, closureAction: "returned" }))) throw stateError(cur.status);
  return done(id);
});

route("POST", "/exceptions/:id/reopen", { perm: "exceptions.reopen" }, async ({ req, user, params }) => {
  const id = reqInt(params.id, "Exception");
  const note = reqStr((await readJson(req)).note, "Reason for reopening", 4000);
  const role = requireAuditor(user, "exceptions.reopen");
  const cur = await getAccessible(user, id);
  if (!(await transition({ id, user, role, from: ["closed"], to: "reopened", event: "reopened", note, closureAction: "reopened" }))) throw stateError(cur.status);
  return done(id);
});
