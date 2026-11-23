import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert, Pager, StatusBadge, TagBadge } from "../ui";
import { FilterBar, cleanFilters } from "../FilterBar";
import { fmtDate, fmtDateTime } from "../format";
import type { Filters } from "../types";
import { RecordDetail } from "./RecordDetail";

export function SearchPage({ mode, initial }: { mode: "search" | "exceptions"; initial?: Filters }) {
  const { can } = useSession();
  const [filters, setFilters] = useState<Filters>(initial ?? {});
  const [sort, setSort] = useState(mode === "exceptions" ? "oldest" : "recent");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: any[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const applied = useRef<Filters>(initial ?? {});

  const body = useCallback(
    (f: Filters, p: number) => ({
      filters: { ...cleanFilters(f), onlyExceptions: mode === "exceptions" || undefined, sort },
      page: p,
      pageSize: 50,
    }),
    [mode, sort],
  );
  const run = useCallback(
    async (f: Filters, p: number) => {
      setLoading(true);
      setError(null);
      try {
        setData(await api.post("/search", body(f, p)));
        setPage(p);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [body],
  );
  useEffect(() => { run(applied.current, 1); }, [run]);

  const exportXlsx = async () => {
    setExporting(true);
    setError(null);
    try {
      await api.download(`/export/${mode === "exceptions" ? "exceptions" : "transactions"}`, { filters: body(applied.current, 1).filters });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const showExc = can("exceptions.view");
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{mode === "exceptions" ? "Exceptions worklist" : "Search transactions"}</h1>
          <p className="muted">
            {mode === "exceptions"
              ? "Every F2S and S2F transaction is an exception case that must be followed up and closed by an Internal Auditor."
              : "Search by transaction ID, transaction date, reconciliation date, tag and terminator — alone or combined."}
          </p>
        </div>
        {can("reports.export") && <button className="btn" onClick={exportXlsx} disabled={exporting}>{exporting ? "Preparing…" : "⬇ Export to Excel"}</button>}
      </div>
      <div className="card">
        <FilterBar
          value={filters}
          onChange={setFilters}
          onApply={() => { applied.current = filters; run(filters, 1); }}
          fields={mode === "exceptions"
            ? ["transId", "bulk", "trans", "recon", "tags", "terminators", "excStatus", "followUp", "superseded"]
            : ["transId", "bulk", "trans", "recon", "tags", "terminators", ...(showExc ? (["excStatus"] as const) : []), "superseded"]}
        />
        {mode === "exceptions" && (
          <div className="row">
            <span className="field-label">Order by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="oldest">Oldest exceptions first</option>
              <option value="activity">Least recent activity first</option>
              <option value="recent">Newest recon date first</option>
            </select>
          </div>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="card flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th><th>Trans ID</th><th title="Date of the underlying transaction">Trans Date</th><th title="Date RAMS recorded the submission">Recon Date</th>
                <th>Terminator</th><th>Tag</th>
                {showExc && <><th>Comments</th><th>Resolution</th><th>Closure</th></>}
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="clickable">
                  <td>{r.displayId}</td>
                  <td><b>{r.transId}</b>{r.occurrences > 1 && <span className="repeat" title="This Trans ID appears in more than one reconciliation record"> ×{r.occurrences}</span>}</td>
                  <td>{fmtDate(r.transDate)}</td>
                  <td>{fmtDate(r.reconDate)}{!r.batchIsCurrent && <span className="muted"> (superseded)</span>}</td>
                  <td>{r.terminator}</td>
                  <td><TagBadge tag={r.tag} /></td>
                  {showExc && (
                    <>
                      <td className="cell-clip">{r.exceptionId ? (r.commentCount ? <><b>{r.commentCount}</b> · <span title={r.latestComment}>{r.latestComment}</span></> : <span className="muted">No comments</span>) : "—"}</td>
                      <td className="cell-clip">{r.exceptionId ? (r.resolution ?? <span className="muted">Not submitted</span>) : <span className="muted">Not applicable</span>}</td>
                      <td>
                        {r.exceptionId ? (
                          <>
                            <StatusBadge status={r.exceptionStatus} />
                            {r.exceptionStatus === "closed" && <div className="small muted">{r.closedBy} · {fmtDateTime(r.closedAt)}</div>}
                            {mode === "exceptions" && r.exceptionStatus !== "closed" && <div className="small muted">{r.ageDays} day{r.ageDays === 1 ? "" : "s"} old · {r.followUp ?? "Unassigned"}</div>}
                          </>
                        ) : <span className="muted">No exception</span>}
                      </td>
                    </>
                  )}
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>Comments & history</button></td>
                </tr>
              ))}
              {data && data.rows.length === 0 && <tr><td colSpan={10} className="empty">No records match these filters.</td></tr>}
              {!data && <tr><td colSpan={10} className="empty">{loading ? "Loading…" : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => run(applied.current, p)} />}
      </div>
      {open !== null && <RecordDetail transactionId={open} onClose={() => setOpen(null)} onChanged={() => run(applied.current, page)} />}
    </>
  );
}
