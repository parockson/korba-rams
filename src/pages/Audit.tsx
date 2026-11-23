import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert, Field, Pager } from "../ui";
import { fmtDateTime } from "../format";

export function AuditPage() {
  const { can } = useSession();
  const [f, setF] = useState<Record<string, string>>({});
  const applied = useRef<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<any>(null);
  const clean = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([, v]) => v));
  const run = useCallback(async (p: number) => {
    try { setError(null); setData(await api.post("/audit/search", { filters: clean(applied.current), page: p, pageSize: 50 })); setPage(p); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { run(1); }, [run]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <div className="page-head"><div><h1>Audit trail</h1><p className="muted">Append-only and hash-chained: edits or removals of past entries are detectable.</p></div>
        <div className="row">
          <button className="btn" onClick={async () => { try { setVerify(await api.get("/audit/verify")); } catch (e) { setError(errMsg(e)); } }}>Verify integrity</button>
          {can("reports.export") && <button className="btn" onClick={() => api.download("/export/audit", { auditFilters: clean(applied.current) }).catch((e) => setError(errMsg(e)))}>⬇ Export</button>}
        </div></div>
      {verify && (verify.intact ? <Alert tone="green">Hash chain verified: all {verify.entries.toLocaleString()} entries are intact.</Alert> : <Alert>Integrity check FAILED. Entries around ID {verify.firstBrokenIds.join(", ")} do not match the chain.</Alert>)}
      <div className="card">
        <form className="filter-grid" onSubmit={(e) => { e.preventDefault(); applied.current = f; run(1); }}>
          <Field label="From"><input type="date" value={f.from ?? ""} onChange={set("from")} /></Field>
          <Field label="To"><input type="date" value={f.to ?? ""} onChange={set("to")} /></Field>
          <Field label="User"><input value={f.username ?? ""} onChange={set("username")} /></Field>
          <Field label="Action contains"><input value={f.action ?? ""} onChange={set("action")} placeholder="e.g. exception.closed" /></Field>
          <Field label="Entity ID"><input value={f.entityId ?? ""} onChange={set("entityId")} /></Field>
          <div className="row" style={{ alignItems: "end" }}><button className="btn btn-primary">Apply</button></div>
        </form>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="card flush">
        <div className="table-wrap"><table className="table table-compact">
          <thead><tr><th>#</th><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
          <tbody>{data?.rows.map((r: any) => (
            <tr key={r.id}><td>{r.id}</td><td>{fmtDateTime(r.occurredAt)}</td><td>{r.username ?? "—"}</td><td>{r.role ?? "—"}</td><td><code>{r.action}</code></td><td>{r.entityType ? `${r.entityType} ${r.entityId ?? ""}` : "—"}</td>
              <td className="cell-clip mono small" title={JSON.stringify(r.detail)}>{JSON.stringify(r.detail)}</td></tr>))}
            {data && !data.rows.length && <tr><td colSpan={7} className="empty">No entries.</td></tr>}</tbody>
        </table></div>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={run} />}
      </div>
    </>
  );
}
