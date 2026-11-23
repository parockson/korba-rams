# RAMS – Reconciliation Audit Monitoring System

Implements the RAMS Detailed SRS v1.0: React + TypeScript frontend, Netlify Functions API, Netlify Database (Postgres), Netlify Blobs for source files.

## Deploy (Netlify)
1. Push this folder to GitHub and create a Netlify site from the repo (build `npm run build`, publish `dist` – already in `netlify.toml`).
2. Initialize **Netlify Database** with `npm run database:create` (requires Netlify CLI 26+ and Node.js 20.12.2+). Netlify Database is available on credit-based plans. Deploy the generated project changes; Netlify provides `NETLIFY_DB_URL` to functions.
3. Set environment variables: `JWT_SECRET` (32+ random chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`; optional `ORG_TIMEZONE` (default Africa/Accra), `MAX_UPLOAD_MB` (default 4 – Netlify Functions cap request bodies near 6 MB), `MAX_ROWS` (50000).
4. Deploy and sign in with the admin credentials (you must change the password). The schema, permissions, default roles and first admin are created automatically on first request (or run `npm run migrate`).
5. In **Administration**: add terminators, create users (e.g. an Internal Auditor and Reconciliation Officers).

Local: `npm install && npx netlify-cli@^26.0.0 dev`.

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
Initialize Netlify Database and configure the production credentials:

```powershell
npm run database:create
npm run setup:db
```

`database:create` runs Netlify's supported `netlify database init --yes` command using Netlify CLI 26+, which installs the database integration and scaffolds its migration setup. Netlify provisions the hosted database as part of deployment and exposes it as `NETLIFY_DB_URL`. `setup:db` sets the production function secrets and admin credentials. Deploy the changes; RAMS creates its schema and first admin on the first API request. These commands require the project to be linked to a logged-in Netlify site.

To override the initial administrator credentials:

```powershell
npm run setup:db -- -AdminUsername "admin" -AdminPassword "use-a-strong-password"
```

## Tests
`npm test` (validation rules, role/permission invariants).
