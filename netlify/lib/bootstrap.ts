import { q, one } from "./db";
import { hashPassword } from "./auth";
import { DEFAULT_ROLES, MIGRATIONS, PERMISSIONS } from "./schema";

let ready: Promise<void> | null = null;

/** Runs pending migrations, syncs the permission catalogue, seeds default roles and the first admin. Idempotent. */
export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = run().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function run() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await q<{ id: string }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    for (const stmt of m.statements) await q(stmt);
    await q(`INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`, [m.id]);
  }
  for (const [key, group, description] of PERMISSIONS) {
    await q(
      `INSERT INTO permissions (key, group_name, description) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET group_name = EXCLUDED.group_name, description = EXCLUDED.description`,
      [key, group, description],
    );
  }
  // default roles are only created when missing - administrators may later change their permissions
  for (const role of DEFAULT_ROLES) {
    const created = await one<{ id: number }>(
      `INSERT INTO roles (name, description, is_auditor, is_system) VALUES ($1,$2,$3,true)
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [role.name, role.description, role.isAuditor],
    );
    if (created) {
      await q(
        `INSERT INTO role_permissions (role_id, permission_key) SELECT $1, k FROM unnest($2::text[]) k ON CONFLICT DO NOTHING`,
        [created.id, role.permissions],
      );
    }
  }
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  if (count && count.n === 0 && process.env.ADMIN_PASSWORD) {
    const username = (process.env.ADMIN_USERNAME || "admin").trim();
    const hash = await hashPassword(process.env.ADMIN_PASSWORD);
    const u = await one<{ id: number }>(
      `INSERT INTO users (username, full_name, password_hash, must_change_password)
       VALUES ($1, 'System Administrator', $2, true) ON CONFLICT DO NOTHING RETURNING id`,
      [username, hash],
    );
    if (u) {
      await q(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'Administrator'`, [u.id]);
      await q(
        `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, detail)
         VALUES ($1, $2, 'user.bootstrap', 'user', $1::text, '{"note":"first administrator created from environment"}'::jsonb)`,
        [u.id, username],
      );
    }
  }
}
