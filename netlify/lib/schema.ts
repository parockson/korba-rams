// Database schema. Every entry is ONE SQL statement (the Neon HTTP driver does not
// run multi-statement strings). All DDL is idempotent so a partly applied migration can be re-run.
// Add new migrations by appending to MIGRATIONS - never edit an applied one.

export interface Migration {
  id: string;
  statements: string[];
}

const immutable = (table: string) => [
  `CREATE OR REPLACE FUNCTION rams_block_change() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`,
  `CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION rams_block_change()`,
];

export const PERMISSIONS: [key: string, group: string, description: string][] = [
  ["users.manage", "Administration", "Create/edit users and assign roles"],
  ["roles.manage", "Administration", "Create/edit roles and their permissions"],
  ["terminators.manage", "Administration", "Create, edit, activate/deactivate terminators"],
  ["settings.manage", "Administration", "Manage reconciliation status options"],
  ["recon.create", "Reconciliation", "Create reconciliation submissions and upload transaction files"],
  ["recon.view", "Reconciliation", "View reconciliation batches and transaction records"],
  ["exceptions.view", "Exceptions", "View exception cases"],
  ["exceptions.comment", "Exceptions", "Add comments to exception cases"],
  ["exceptions.assign", "Exceptions", "Assign / reassign the follow-up person"],
  ["exceptions.resolve", "Exceptions", "Start investigation and submit resolution explanations"],
  ["exceptions.close", "Exceptions", "Close exceptions / return for rework (auditor roles only)"],
  ["exceptions.reopen", "Exceptions", "Reopen closed exceptions (auditor roles only)"],
  ["dashboard.view", "Reporting", "View the dashboard"],
  ["reports.export", "Reporting", "Download reports and filtered results as Excel"],
  ["audit.view", "Reporting", "View and export the audit trail"],
];

export const DEFAULT_ROLES: {
  name: string;
  description: string;
  isAuditor: boolean;
  permissions: string[];
}[] = [
  {
    name: "Administrator",
    description: "Manage users, roles, permissions, terminators and configuration; inspect audit logs.",
    isAuditor: false,
    permissions: [
      "users.manage", "roles.manage", "terminators.manage", "settings.manage",
      "recon.view", "exceptions.view", "dashboard.view", "reports.export", "audit.view",
    ],
  },
  {
    name: "Reconciliation Officer",
    description: "Create submissions, upload files, comment on and resolve exceptions.",
    isAuditor: false,
    permissions: [
      "recon.create", "recon.view", "exceptions.view", "exceptions.comment",
      "exceptions.assign", "exceptions.resolve", "dashboard.view",
    ],
  },
  {
    name: "Internal Auditor",
    description: "Monitor, investigate, assign, verify resolutions, close or reopen cases.",
    isAuditor: true,
    permissions: [
      "recon.create", "recon.view", "exceptions.view", "exceptions.comment",
      "exceptions.assign", "exceptions.resolve", "exceptions.close", "exceptions.reopen",
      "dashboard.view", "reports.export", "audit.view",
    ],
  },
  {
    name: "Management / Viewer",
    description: "Read-only access to permitted dashboards and reports.",
    isAuditor: false,
    permissions: ["recon.view", "exceptions.view", "dashboard.view", "reports.export"],
  },
];

export const MIGRATIONS: Migration[] = [
  {
    id: "001_core",
    statements: [
      `CREATE TABLE IF NOT EXISTS permissions (
         key text PRIMARY KEY,
         group_name text NOT NULL,
         description text NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS roles (
         id serial PRIMARY KEY,
         name text NOT NULL UNIQUE,
         description text NOT NULL DEFAULT '',
         is_auditor boolean NOT NULL DEFAULT false,
         is_system boolean NOT NULL DEFAULT false,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS role_permissions (
         role_id int NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
         permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
         PRIMARY KEY (role_id, permission_key)
       )`,
      `CREATE TABLE IF NOT EXISTS users (
         id serial PRIMARY KEY,
         username text NOT NULL,
         full_name text NOT NULL,
         email text,
         password_hash text NOT NULL,
         is_active boolean NOT NULL DEFAULT true,
         must_change_password boolean NOT NULL DEFAULT true,
         terminator_scope int[] NOT NULL DEFAULT '{}',
         failed_attempts int NOT NULL DEFAULT 0,
         locked_until timestamptz,
         last_login_at timestamptz,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username))`,
      `CREATE TABLE IF NOT EXISTS user_roles (
         user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         role_id int NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
         PRIMARY KEY (user_id, role_id)
       )`,
      `CREATE TABLE IF NOT EXISTS terminators (
         id serial PRIMARY KEY,
         code text NOT NULL UNIQUE,
         name text NOT NULL,
         is_active boolean NOT NULL DEFAULT true,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS recon_statuses (
         id serial PRIMARY KEY,
         name text NOT NULL UNIQUE,
         sort_order int NOT NULL DEFAULT 0,
         is_active boolean NOT NULL DEFAULT true
       )`,
      `INSERT INTO recon_statuses (name, sort_order) VALUES
         ('Pending', 1), ('In Progress', 2), ('Completed', 3)
       ON CONFLICT (name) DO NOTHING`,

      // ---------- reconciliation batches & transactions ----------
      `CREATE TABLE IF NOT EXISTS reconciliation_batches (
         id bigserial PRIMARY KEY,
         reference text GENERATED ALWAYS AS ('RAMS-B-' || lpad(id::text, 6, '0')) STORED,
         terminator_id int NOT NULL REFERENCES terminators(id),
         status_id int NOT NULL REFERENCES recon_statuses(id),
         recon_date date NOT NULL,
         submitted_at timestamptz NOT NULL DEFAULT now(),
         uploaded_by int NOT NULL REFERENCES users(id),
         original_filename text NOT NULL,
         storage_key text NOT NULL,
         file_sha256 text NOT NULL,
         file_size bigint NOT NULL,
         txn_date_min date,
         txn_date_max date,
         transaction_count int NOT NULL,
         p2s_count int NOT NULL,
         p2f_count int NOT NULL,
         f2s_count int NOT NULL,
         s2f_count int NOT NULL,
         exception_count int NOT NULL,
         exception_pct numeric(7,3) NOT NULL DEFAULT 0,
         rejected_count int NOT NULL DEFAULT 0,
         rejected_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
         officer_remarks text,
         version int NOT NULL DEFAULT 1,
         parent_batch_id bigint REFERENCES reconciliation_batches(id),
         correction_reason text,
         is_current boolean NOT NULL DEFAULT true,
         superseded_by bigint REFERENCES reconciliation_batches(id),
         CONSTRAINT batch_counts_reconcile CHECK (
           p2s_count + p2f_count + f2s_count + s2f_count = transaction_count
           AND exception_count = f2s_count + s2f_count)
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS batches_reference_key ON reconciliation_batches (reference)`,
      `CREATE INDEX IF NOT EXISTS batches_term_date_idx ON reconciliation_batches (terminator_id, recon_date)`,
      `CREATE INDEX IF NOT EXISTS batches_recon_date_idx ON reconciliation_batches (recon_date)`,
      `CREATE TABLE IF NOT EXISTS transaction_records (
         id bigserial PRIMARY KEY,
         display_id text GENERATED ALWAYS AS ('RAMS-TX-' || lpad(id::text, 6, '0')) STORED,
         batch_id bigint NOT NULL REFERENCES reconciliation_batches(id),
         row_number int NOT NULL,
         trans_id text NOT NULL,
         trans_date date NOT NULL,
         tag text NOT NULL CHECK (tag IN ('P2S','P2F','F2S','S2F')),
         UNIQUE (batch_id, trans_id)
       )`,
      `CREATE INDEX IF NOT EXISTS tx_trans_id_lower_idx ON transaction_records (lower(trans_id))`,
      `CREATE INDEX IF NOT EXISTS tx_trans_date_idx ON transaction_records (trans_date)`,
      `CREATE INDEX IF NOT EXISTS tx_tag_idx ON transaction_records (tag)`,
      `CREATE INDEX IF NOT EXISTS tx_batch_idx ON transaction_records (batch_id)`,

      // ---------- follow-up contacts & exceptions ----------
      `CREATE TABLE IF NOT EXISTS follow_up_contacts (
         id serial PRIMARY KEY,
         name text NOT NULL,
         user_id int REFERENCES users(id),
         use_count int NOT NULL DEFAULT 0,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS contacts_name_key ON follow_up_contacts (lower(name))`,
      `CREATE TABLE IF NOT EXISTS exceptions (
         id bigserial PRIMARY KEY,
         display_id text GENERATED ALWAYS AS ('RAMS-EX-' || lpad(id::text, 6, '0')) STORED,
         transaction_id bigint NOT NULL UNIQUE REFERENCES transaction_records(id),
         batch_id bigint NOT NULL REFERENCES reconciliation_batches(id),
         tag text NOT NULL CHECK (tag IN ('F2S','S2F')),
         status text NOT NULL DEFAULT 'open'
           CHECK (status IN ('open','investigating','resolution_submitted','closed','reopened')),
         issue_description text,
         follow_up_contact_id int REFERENCES follow_up_contacts(id),
         follow_up_name text,
         closed_by_name text,
         closed_by_role text,
         closed_at timestamptz,
         closure_note text,
         created_at timestamptz NOT NULL DEFAULT now(),
         last_activity_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions (status)`,
      `CREATE INDEX IF NOT EXISTS exceptions_batch_idx ON exceptions (batch_id)`,
      `CREATE TABLE IF NOT EXISTS exception_assignments (
         id bigserial PRIMARY KEY,
         exception_id bigint NOT NULL REFERENCES exceptions(id),
         follow_up_name text NOT NULL,
         contact_id int REFERENCES follow_up_contacts(id),
         user_id int REFERENCES users(id),
         previous_name text,
         assigned_by int NOT NULL REFERENCES users(id),
         assigned_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS exception_comments (
         id bigserial PRIMARY KEY,
         exception_id bigint NOT NULL REFERENCES exceptions(id),
         author_id int NOT NULL REFERENCES users(id),
         author_name text NOT NULL,
         author_role text NOT NULL,
         body text NOT NULL CHECK (length(trim(body)) > 0),
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS comments_exc_idx ON exception_comments (exception_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS exception_resolutions (
         id bigserial PRIMARY KEY,
         exception_id bigint NOT NULL REFERENCES exceptions(id),
         explanation text NOT NULL CHECK (length(trim(explanation)) > 0),
         evidence_reference text,
         submitted_by int NOT NULL REFERENCES users(id),
         submitted_by_name text NOT NULL,
         submitted_role text NOT NULL,
         submitted_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS exception_closures (
         id bigserial PRIMARY KEY,
         exception_id bigint NOT NULL REFERENCES exceptions(id),
         action text NOT NULL CHECK (action IN ('closed','returned','reopened')),
         note text NOT NULL CHECK (length(trim(note)) > 0),
         user_id int NOT NULL REFERENCES users(id),
         user_name text NOT NULL,
         role_name text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE TABLE IF NOT EXISTS exception_events (
         id bigserial PRIMARY KEY,
         exception_id bigint NOT NULL REFERENCES exceptions(id),
         event_type text NOT NULL,
         actor_id int,
         actor_name text NOT NULL,
         actor_role text,
         detail jsonb NOT NULL DEFAULT '{}'::jsonb,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX IF NOT EXISTS events_exc_idx ON exception_events (exception_id, created_at, id)`,

      // ---------- audit log (append-only, hash-chained) ----------
      `CREATE TABLE IF NOT EXISTS audit_logs (
         id bigserial PRIMARY KEY,
         occurred_at timestamptz NOT NULL DEFAULT now(),
         user_id int,
         username text,
         role_name text,
         action text NOT NULL,
         entity_type text,
         entity_id text,
         detail jsonb NOT NULL DEFAULT '{}'::jsonb,
         prev_hash text,
         hash text
       )`,
      `CREATE INDEX IF NOT EXISTS audit_time_idx ON audit_logs (occurred_at DESC)`,
      `CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs (action)`,
      `CREATE OR REPLACE FUNCTION rams_audit_payload(r audit_logs) RETURNS text AS $$
         SELECT concat_ws('|', r.id,
           to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
           coalesce(r.user_id::text, ''), coalesce(r.username, ''), coalesce(r.role_name, ''),
           r.action, coalesce(r.entity_type, ''), coalesce(r.entity_id, ''), r.detail::text)
       $$ LANGUAGE sql IMMUTABLE`,
      `CREATE OR REPLACE FUNCTION rams_audit_chain() RETURNS trigger AS $$
       DECLARE last_hash text;
       BEGIN
         PERFORM pg_advisory_xact_lock(727001);
         SELECT hash INTO last_hash FROM audit_logs ORDER BY id DESC LIMIT 1;
         NEW.prev_hash := coalesce(last_hash, 'GENESIS');
         NEW.hash := encode(sha256(convert_to(NEW.prev_hash || '|' || rams_audit_payload(NEW), 'UTF8')), 'hex');
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS audit_logs_chain ON audit_logs`,
      `CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION rams_audit_chain()`,

      // ---------- immutability ----------
      ...immutable("audit_logs"),
      ...immutable("exception_comments").slice(1),
      ...immutable("exception_resolutions").slice(1),
      ...immutable("exception_closures").slice(1),
      ...immutable("exception_events").slice(1),
      ...immutable("exception_assignments").slice(1),
      ...immutable("transaction_records").slice(1),
      `CREATE OR REPLACE FUNCTION rams_batch_guard() RETURNS trigger AS $$
       BEGIN
         IF TG_OP = 'DELETE' THEN
           RAISE EXCEPTION 'reconciliation_batches rows cannot be deleted';
         END IF;
         -- only the version-control columns may change after submission
         IF (to_jsonb(NEW) - 'is_current' - 'superseded_by') IS DISTINCT FROM
            (to_jsonb(OLD) - 'is_current' - 'superseded_by') THEN
           RAISE EXCEPTION 'submitted reconciliation batches are immutable';
         END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS batches_guard ON reconciliation_batches`,
      `CREATE TRIGGER batches_guard BEFORE UPDATE OR DELETE ON reconciliation_batches
         FOR EACH ROW EXECUTE FUNCTION rams_batch_guard()`,
      `CREATE OR REPLACE FUNCTION rams_no_delete() RETURNS trigger AS $$
       BEGIN RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME; END;
       $$ LANGUAGE plpgsql`,
      `DROP TRIGGER IF EXISTS exceptions_no_delete ON exceptions`,
      `CREATE TRIGGER exceptions_no_delete BEFORE DELETE ON exceptions
         FOR EACH ROW EXECUTE FUNCTION rams_no_delete()`,
      `DROP TRIGGER IF EXISTS terminators_no_delete ON terminators`,
      `CREATE TRIGGER terminators_no_delete BEFORE DELETE ON terminators
         FOR EACH ROW EXECUTE FUNCTION rams_no_delete()`,
    ],
  },
];
