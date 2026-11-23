import { useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert } from "../ui";
import { FilterBar, cleanFilters } from "../FilterBar";
import type { Filters } from "../types";

const REPORTS: { key: string; title: string; desc: string; exc?: boolean }[] = [
  { key: "summary", title: "Reconciliation Summary", desc: "Batch, terminator, recon date, status, uploader, counts and exception totals." },
  { key: "transactions", title: "Transaction Detail", desc: "Results, Comments, History and Batch Summary worksheets for the filtered transactions." },
  { key: "status-change", title: "Status Change Report", desc: "P2S / P2F / F2S / S2F counts with transaction-level detail." },
  { key: "exceptions", title: "Exception Register", desc: "All F2S and S2F cases with owner, status, comments, resolution and history.", exc: true },
  { key: "outstanding", title: "Outstanding Exceptions", desc: "Cases not closed, with age and latest activity.", exc: true },
  { key: "closed", title: "Closed Exceptions", desc: "Closed cases with resolution, closure note, closing auditor and date.", exc: true },
  { key: "followup", title: "Follow-up Activity", desc: "Comments, assignment history, status changes and timestamps.", exc: true },
  { key: "officers", title: "Officer Activity", desc: "Submissions and follow-up activity per user (uses the Recon Date range)." },
];

export function ReportsPage() {
  const { can, session } = useSession();
  const [filters, setFilters] = useState<Filters>({});
  const [auditF, setAuditF] = useState({ from: "", to: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string) => {
    setBusy(key); setError(null);
    try {
      await api.download(`/export/${key}`, { filters: cleanFilters(filters), auditFilters: Object.fromEntries(Object.entries(auditF).filter(([, v]) => v)) });
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  void session;
  return (
    <>
      <div className="page-head"><div><h1>Reports</h1><p className="muted">All reports download as Excel and respect the filters below and your data access. Each workbook records who generated it, when, and the filters used.</p></div></div>
      <div className="card"><FilterBar value={filters} onChange={setFilters} fields={["transId", "bulk", "trans", "recon", "tags", "terminators", "excStatus", "reconStatus", "followUp", "superseded"]} /></div>
      {error && <Alert>{error}</Alert>}
      <div className="grid2">
        {REPORTS.filter((r) => !r.exc || can("exceptions.view")).map((r) => (
          <div className="card" key={r.key}>
            <h3>{r.title}</h3><p className="muted">{r.desc}</p>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run(r.key)}>{busy === r.key ? "Preparing…" : "⬇ Download Excel"}</button>
          </div>
        ))}
        {can("audit.view") && (
          <div className="card">
            <h3>Audit Trail</h3><p className="muted">User actions with before/after values. Uses its own date range:</p>
            <div className="row"><input type="date" value={auditF.from} onChange={(e) => setAuditF({ ...auditF, from: e.target.value })} /><input type="date" value={auditF.to} onChange={(e) => setAuditF({ ...auditF, to: e.target.value })} /></div>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run("audit")}>{busy === "audit" ? "Preparing…" : "⬇ Download Excel"}</button>
          </div>
        )}
      </div>
    </>
  );
}
