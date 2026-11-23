# RAMS – Reconciliation Audit Monitoring System

Implements the RAMS Detailed SRS v1.0: React + TypeScript frontend, Netlify Functions API, Netlify Database (Postgres), Netlify Blobs for source files.

## Deploy (Netlify)
1. Push this folder to GitHub and create a Netlify site from the repo (build `npm run build`, publish `dist` – already in `netlify.toml`).
2. Provision **Netlify Database** for the site (`npx netlify db init`) so `NETLIFY_DATABASE_URL` exists. Confirm plan limits, region and backups (SRS §14).
3. Set environment variables: `JWT_SECRET` (32+ random chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`; optional `ORG_TIMEZONE` (default Africa/Accra), `MAX_UPLOAD_MB` (default 4 – Netlify Functions cap request bodies near 6 MB), `MAX_ROWS` (50000).
4. Deploy and sign in with the admin credentials (you must change the password). The schema, permissions, default roles and first admin are created automatically on first request (or run `npm run migrate`).
5. In **Administration**: add terminators, create users (e.g. an Internal Auditor and Reconciliation Officers).

Local: `npm install && npx netlify dev`.

## Key behaviours
- Upload → validate/preview → choose terminator + status → submit. Recon Date is generated server-side at successful submit (org timezone).
- One atomic SQL statement creates the batch, transactions, F2S/S2F exceptions and audit entry – no partial submissions, no duplicate exceptions.
- Same terminator + recon date twice must be filed as a **correction** (new version; original, file and exceptions preserved).
- Rejected rows are listed, recorded on the batch, and excluded only after explicit acknowledgement.
- Exception lifecycle: Open → Investigating → Resolution Submitted → Closed / Reopened. Close, return and reopen work only through a role flagged *auditor* that holds the permission; the role cannot be granted to non-auditor roles. Enforced on the API.
- Comments, resolutions, closures, events and audit logs are append-only (database triggers); audit log is SHA-256 hash-chained (Audit → Verify integrity).
- Excel exports (Results / Comments / History / Batch Summary, plus Report Info with user, time, filters).
- Optional per-user terminator scope limits all data a user can see or export.

## Decisions taken where the SRS left options (SRS §19)
Statuses Pending/In Progress/Completed (editable); auditors may submit; issue description optional; external follow-up contacts allowed; assignment permission configurable (officers and auditors by default); duplicate file rows rejected; one file per batch; no notifications.

## Database setup
Create a PostgreSQL database in Netlify Database or another PostgreSQL provider, then configure and migrate it:

```powershell
npm run setup:db
```

The setup script prompts for the PostgreSQL connection string. To provide it non-interactively:

```powershell
npm run setup:db -- -DatabaseUrl "postgresql://..." -AdminUsername "admin" -AdminPassword "password@12345"
```

The script creates Netlify environment variables, creates the RAMS tables and seeds the first administrator. It does not create the PostgreSQL account or database itself.

## Tests
`npm test` (validation rules, role/permission invariants).
