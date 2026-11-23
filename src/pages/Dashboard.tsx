import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert, Bars, Stat } from "../ui";
import { FilterBar, cleanFilters } from "../FilterBar";
import { EXC_STATUS_LABEL, type Filters } from "../types";
import { pct } from "../format";

export function DashboardPage() {
  const { can } = useSession();
  const [filters, setFilters] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});
  const [period, setPeriod] = useState("month");
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaders, setUploaders] = useState<{ id: number; fullName: string }[]>([]);

  useEffect(() => { api.get("/users").then((r) => setUploaders(r.users)).catch(() => {}); }, []);
  useEffect(() => {
    setError(null);
    api.post("/dashboard", { filters: cleanFilters(applied), period }).then(setD).catch((e) => setError(errMsg(e)));
  }, [applied, period]);

  const showExc = can("exceptions.view");
  const t = d?.tags;
  const excStatus = (k: string) => d?.exceptionByStatus?.find((x: any) => x.label === k)?.value ?? 0;
  return (
    <>
      <div className="page-head"><div><h1>Dashboard</h1><p className="muted">Live view of reconciliation activity and exceptions. Counts use current (non-superseded) batch versions.</p></div></div>
      <details className="card">
        <summary><b>Filters</b></summary>
        <FilterBar value={filters} onChange={setFilters} onApply={() => setApplied(filters)} uploaders={uploaders}
          fields={["trans", "recon", "tags", "terminators", ...(showExc ? (["excStatus", "followUp"] as const) : []), "reconStatus", "uploader"]} />
        <p className="muted small">Batch figures use the reconciliation date, terminator, status and uploader filters. Transaction and exception figures use all filters.</p>
      </details>
      {error && <Alert>{error}</Alert>}
      {!d && !error && <p className="muted">Loading…</p>}
      {d && (
        <>
          <div className="stats">
            <Stat label="Reconciliation submissions" value={d.totals.submissions.toLocaleString()} />
            <Stat label="Transactions processed" value={(t?.total ?? 0).toLocaleString()} />
            <Stat label="P2S" value={(t?.p2s ?? 0).toLocaleString()} />
            <Stat label="P2F" value={(t?.p2f ?? 0).toLocaleString()} />
            <Stat label="F2S" value={(t?.f2s ?? 0).toLocaleString()} tone="red" />
            <Stat label="S2F" value={(t?.s2f ?? 0).toLocaleString()} tone="red" />
            <Stat label="Total exceptions" value={((t?.f2s ?? 0) + (t?.s2f ?? 0)).toLocaleString()} tone="red" sub={t?.total ? pct(((t.f2s + t.s2f) / t.total) * 100) + " of transactions" : undefined} />
          </div>
          {showExc && d.exceptionByStatus && (
            <div className="stats">
              {Object.entries(EXC_STATUS_LABEL).map(([k, label]) => <Stat key={k} label={label} value={excStatus(k).toLocaleString()} tone={k === "closed" ? "green" : k === "open" || k === "reopened" ? "amber" : undefined} />)}
            </div>
          )}
          <div className="grid2">
            <div className="card">
              <div className="row between"><h3>Submissions by period</h3>
                <select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></div>
              <Bars rows={d.byPeriod.map((r: any) => ({ label: r.period, value: r.submissions, extra: <span className="muted"> · {r.transactions?.toLocaleString()} txns</span> }))} />
            </div>
            <div className="card"><h3>Reconciliation status</h3><Bars rows={d.byStatus} /></div>
            <div className="card"><h3>Exception rate by terminator</h3>
              <Bars rows={d.byTerminator.map((r: any) => ({ label: r.label, value: r.rate, extra: <span className="muted">% · {r.exceptions}/{r.transactions}</span> }))} />
            </div>
            <div className="card"><h3>Submissions by officer</h3><Bars rows={d.byOfficer} /></div>
            {showExc && <div className="card"><h3>Outstanding exceptions by age</h3><Bars rows={d.aging ?? []} empty="No outstanding exceptions." /></div>}
            {showExc && <div className="card"><h3>Outstanding exceptions by follow-up person</h3><Bars rows={d.byFollowUp ?? []} empty="No outstanding exceptions." /></div>}
          </div>
          <div className="card">
            <h3>Recurring transaction IDs</h3>
            <p className="muted">Trans IDs that appear in more than one reconciliation batch — for audit review, not necessarily errors.</p>
            {d.recurring.length === 0 ? <p className="muted">No repeated transaction IDs for the selected filters.</p> : (
              <table className="table table-compact">
                <thead><tr><th>Trans ID</th><th>Batches</th><th>Occurrences</th><th>As exceptions</th><th>Tags seen</th></tr></thead>
                <tbody>{d.recurring.map((r: any) => <tr key={r.transId}><td><a href={`#/search?id=${encodeURIComponent(r.transId)}`}>{r.transId}</a></td><td>{r.batches}</td><td>{r.occurrences}</td><td>{r.exceptionOccurrences}</td><td>{r.tags}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
