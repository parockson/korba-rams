import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api";
import { useSession, go } from "../session";
import { Alert, Badge, Modal, Pager } from "../ui";
import { FilterBar, cleanFilters } from "../FilterBar";
import { fmtBytes, fmtDate, fmtDateTime, pct } from "../format";
import type { Filters } from "../types";

function BatchDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useSession();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get(`/batches/${id}`).then(setD).catch((e) => setError(errMsg(e))); }, [id]);
  if (!d) return <Modal title="Reconciliation batch" onClose={onClose}>{error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>}</Modal>;
  const b = d.batch;
  return (
    <Modal wide onClose={onClose} title={<>{b.reference} · v{b.version} {b.isCurrent ? <Badge tone="green">Current</Badge> : <Badge tone="amber">Superseded</Badge>}</>}>
      <div className="kv">
        <div><span>Terminator</span><b>{b.terminator}</b></div>
        <div><span>Recon Date (system)</span><b>{fmtDate(b.reconDate)}</b></div>
        <div><span>Submitted</span><b>{fmtDateTime(b.submittedAt)}</b></div>
        <div><span>Uploaded by</span><b>{b.uploadedBy}</b></div>
        <div><span>Reconciliation status</span><b>{b.status}</b></div>
        <div><span>Source file</span><b>{b.filename} ({fmtBytes(b.fileSize)})</b></div>
        <div><span>Trans Date range</span><b>{b.txnDateMin ? `${fmtDate(b.txnDateMin)} – ${fmtDate(b.txnDateMax)}` : "—"}</b></div>
        <div><span>SHA-256</span><b className="mono small">{b.sha256.slice(0, 16)}…</b></div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-value">{b.transactionCount}</div><div className="stat-label">Transactions</div></div>
        <div className="stat"><div className="stat-value">{b.p2s}</div><div className="stat-label">P2S</div></div>
        <div className="stat"><div className="stat-value">{b.p2f}</div><div className="stat-label">P2F</div></div>
        <div className="stat stat-red"><div className="stat-value">{b.f2s}</div><div className="stat-label">F2S</div></div>
        <div className="stat stat-red"><div className="stat-value">{b.s2f}</div><div className="stat-label">S2F</div></div>
        <div className="stat"><div className="stat-value">{pct(b.exceptionPct)}</div><div className="stat-label">Exception rate</div></div>
      </div>
      {d.exceptionStats && <p>Exceptions: <b>{d.exceptionStats.exceptions}</b> total · <b>{d.exceptionStats.outstanding}</b> outstanding · <b>{d.exceptionStats.closed}</b> closed</p>}
      {b.officerRemarks && <p><b>Officer remarks:</b> {b.officerRemarks}</p>}
      {b.correctionReason && <Alert tone="amber"><b>Correction reason:</b> {b.correctionReason}</Alert>}
      <div className="row">
        <button className="btn btn-primary" onClick={() => go(`/search?batch=${b.id}`)}>View transactions</button>
        {can("exceptions.view") && <button className="btn" onClick={() => go(`/exceptions?batch=${b.id}`)}>View exceptions</button>}
        <a className="btn" href={`/api/batches/${b.id}/file`}>⬇ Download original file</a>
      </div>
      {d.versions.length > 1 && (
        <>
          <h4>Version history</h4>
          <table className="table table-compact">
            <thead><tr><th>Version</th><th>Batch</th><th>Submitted</th><th>By</th><th>Txns</th><th>Exceptions</th><th>Reason</th></tr></thead>
            <tbody>{d.versions.map((v: any) => <tr key={v.id} className={v.id === b.id ? "row-current" : ""}><td>v{v.version}{v.isCurrent ? " (current)" : ""}</td><td><button className="link" onClick={() => go(`/batches?open=${v.id}`)}>{v.reference}</button></td><td>{fmtDateTime(v.submittedAt)}</td><td>{v.uploadedBy}</td><td>{v.transactionCount}</td><td>{v.exceptionCount}</td><td>{v.correctionReason ?? "Original"}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {b.rejectedCount > 0 && (
        <details>
          <summary><b>{b.rejectedCount} rejected row(s) excluded at submission</b></summary>
          <table className="table table-compact">
            <thead><tr><th>Row</th><th>Trans Date</th><th>Trans ID</th><th>Tag</th><th>Problem</th></tr></thead>
            <tbody>{b.rejectedRows.map((r: any) => <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.transDate}</td><td>{r.transId}</td><td>{r.tag}</td><td className="err">{r.errors.join("; ")}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </Modal>
  );
}

export function BatchesPage({ openId }: { openId?: number }) {
  const { can } = useSession();
  const [filters, setFilters] = useState<Filters>({});
  const applied = useRef<Filters>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(openId ?? null);
  const [uploaders, setUploaders] = useState<{ id: number; fullName: string }[]>([]);
  useEffect(() => { setOpen(openId ?? null); }, [openId]);
  useEffect(() => { api.get("/users").then((r) => setUploaders(r.users)).catch(() => {}); }, []);
  const run = useCallback(async (p: number) => {
    try { setError(null); setData(await api.post("/batches/search", { filters: cleanFilters(applied.current), page: p, pageSize: 25 })); setPage(p); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { run(1); }, [run]);
  return (
    <>
      <div className="page-head">
        <div><h1>Reconciliations</h1><p className="muted">Every submitted batch with its source file, counts and version history.</p></div>
        <div className="row">
          {can("reports.export") && <button className="btn" onClick={() => api.download("/export/summary", { filters: cleanFilters(applied.current) }).catch((e) => setError(errMsg(e)))}>⬇ Export summary</button>}
          {can("recon.create") && <button className="btn btn-primary" onClick={() => go("/new")}>＋ New reconciliation</button>}
        </div>
      </div>
      <div className="card"><FilterBar value={filters} onChange={setFilters} onApply={() => { applied.current = filters; run(1); }} fields={["recon", "terminators", "reconStatus", "uploader", "superseded"]} uploaders={uploaders} /></div>
      {error && <Alert>{error}</Alert>}
      <div className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Batch</th><th>Terminator</th><th>Recon Date</th><th>Status</th><th>Uploaded by</th><th>File</th><th>Txns</th><th>F2S</th><th>S2F</th><th>Exception %</th></tr></thead>
            <tbody>
              {data?.rows.map((b: any) => (
                <tr key={b.id} className="clickable" onClick={() => setOpen(b.id)}>
                  <td><b>{b.reference}</b> <span className="muted">v{b.version}</span>{!b.isCurrent && <> <Badge tone="amber">Superseded</Badge></>}</td>
                  <td>{b.terminator}</td><td>{fmtDate(b.reconDate)}</td><td>{b.status}</td><td>{b.uploadedBy}</td><td className="cell-clip">{b.filename}</td>
                  <td>{b.transactionCount.toLocaleString()}</td><td>{b.f2s}</td><td>{b.s2f}</td><td>{pct(b.exceptionPct)}</td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={10} className="empty">No reconciliations found.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={run} />}
      </div>
      {open !== null && <BatchDetail id={open} onClose={() => { setOpen(null); if (openId) go("/batches"); }} />}
    </>
  );
}
