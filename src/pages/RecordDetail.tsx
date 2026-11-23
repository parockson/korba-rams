import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert, Badge, Modal, StatusBadge, TagBadge, useDebounced, useToast } from "../ui";
import { fmtDate, fmtDateTime } from "../format";

const EVENT_LABEL: Record<string, string> = {
  created: "Exception created", comment: "Comment added", assigned: "Assigned", reassigned: "Reassigned", issue_updated: "Issue description updated",
  investigation_started: "Investigation started", resolution_submitted: "Resolution submitted", closed: "Closed by auditor",
  returned_for_rework: "Returned for rework", reopened: "Reopened",
};

function FollowUpPicker({ current, onAssign, busy }: { current?: string | null; onAssign: (name: string, userId?: number) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const [userId, setUserId] = useState<number | undefined>();
  const [list, setList] = useState<{ id: number; name: string; userId: number | null }[]>([]);
  const [users, setUsers] = useState<{ id: number; fullName: string }[]>([]);
  const [open, setOpen] = useState(false);
  const term = useDebounced(text, 200);
  useEffect(() => {
    api.get("/users").then((r) => setUsers(r.users)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    api.get(`/contacts?q=${encodeURIComponent(term)}`).then((r) => setList(r.contacts)).catch(() => setList([]));
  }, [term, open]);
  return (
    <div className="followup">
      <div className="suggest">
        <input
          value={text}
          placeholder={current ? "Reassign to…" : "Type a name — previous names are suggested"}
          onChange={(e) => { setText(e.target.value); setUserId(undefined); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          maxLength={120}
        />
        {open && list.length > 0 && (
          <ul className="suggest-list">
            {list.map((c) => (
              <li key={c.id} onMouseDown={() => { setText(c.name); setUserId(c.userId ?? undefined); setOpen(false); }}>
                {c.name} {c.userId && <Badge tone="teal">RAMS user</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <select value={userId ?? ""} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Link to a registered user (optional)">
        <option value="">External / no RAMS account</option>
        {users.map((u) => <option key={u.id} value={u.id}>Link to {u.fullName}</option>)}
      </select>
      <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => { onAssign(text.trim(), userId); setText(""); setUserId(undefined); }}>
        {current ? "Reassign" : "Assign"}
      </button>
    </div>
  );
}

export function RecordDetail({ transactionId, onClose, onChanged }: { transactionId: number; onClose: () => void; onChanged?: () => void }) {
  const { can, canClose, canReopen } = useSession();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [explanation, setExplanation] = useState("");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/transactions/${transactionId}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [transactionId]);
  useEffect(() => { load(); }, [load]);

  const act = async (path: string, body: unknown, okMsg: string, reset?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(path, body);
      setData((d: any) => ({ ...d, exception: r.exception }));
      reset?.();
      toast.show(okMsg);
      onChanged?.();
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Modal title="Record" onClose={onClose}>{error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>}</Modal>;
  const tx = data.transaction;
  const ex = data.exception;
  const st: string | undefined = ex?.status;
  const exId = ex?.id;
  const editable = st && st !== "closed";

  return (
    <Modal wide onClose={onClose} title={<>{tx.displayId} · {tx.transId} <TagBadge tag={tx.tag} /></>}>
      {toast.node}
      {error && <Alert>{error}</Alert>}
      <div className="kv">
        <div><span>Trans ID</span><b>{tx.transId}</b></div>
        <div><span>Trans Date</span><b>{fmtDate(tx.transDate)}</b></div>
        <div><span>Recon Date</span><b>{fmtDate(tx.reconDate)}</b></div>
        <div><span>Terminator</span><b>{tx.terminator}</b></div>
        <div><span>Batch</span><b>{tx.batchRef} (v{tx.batchVersion}{tx.batchIsCurrent ? "" : ", superseded"})</b></div>
        <div><span>Source file</span><b>{tx.filename} · row {tx.rowNumber}</b></div>
        <div><span>Submitted by</span><b>{tx.uploadedBy} · {fmtDateTime(tx.submittedAt)}</b></div>
        <div><span>Reconciliation status</span><b>{tx.reconStatus}</b></div>
      </div>

      {data.occurrences.length > 1 && (
        <details className="section" open>
          <summary>This Trans ID appears in {data.occurrences.length} reconciliation records</summary>
          <p className="muted">Shown for audit visibility — a repeated ID is not necessarily an error.</p>
          <table className="table table-compact">
            <thead><tr><th>Record</th><th>Batch</th><th>Recon Date</th><th>Trans Date</th><th>Terminator</th><th>Tag</th><th>Exception</th></tr></thead>
            <tbody>
              {data.occurrences.map((o: any) => (
                <tr key={o.id} className={o.id === tx.id ? "row-current" : ""}>
                  <td>{o.displayId}{o.id === tx.id && " (this)"}</td><td>{o.batchRef} v{o.batchVersion}{o.batchIsCurrent ? "" : " (superseded)"}</td>
                  <td>{fmtDate(o.reconDate)}</td><td>{fmtDate(o.transDate)}</td><td>{o.terminator}</td><td><TagBadge tag={o.tag} /></td>
                  <td>{o.exceptionDisplayId ? <><span>{o.exceptionDisplayId} </span><StatusBadge status={o.exceptionStatus} /></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {!ex && <Alert tone="blue">{tx.tag === "P2S" || tx.tag === "P2F" ? "This is a normal status transition, so no exception case was created." : "You do not have permission to view the exception for this record."}</Alert>}

      {ex && (
        <>
          <div className="section">
            <div className="row between">
              <h3>Exception {ex.displayId}</h3>
              <StatusBadge status={ex.status} />
            </div>
            <div className="kv">
              <div><span>Follow-up person</span><b>{ex.followUp ?? "Not assigned"}{ex.followUpUserId ? " (RAMS user)" : ex.followUp ? " (external contact – not a login)" : ""}</b></div>
              <div><span>Created</span><b>{fmtDateTime(ex.createdAt)}</b></div>
              <div><span>Last activity</span><b>{fmtDateTime(ex.lastActivityAt)}</b></div>
              {st === "closed" && <div><span>Closed by</span><b>{ex.closedBy} ({ex.closedByRole}) · {fmtDateTime(ex.closedAt)}</b></div>}
            </div>
            {st === "closed" && <Alert tone="green"><b>Closure note:</b> {ex.closureNote}</Alert>}
            {st === "resolution_submitted" && <Alert tone="blue">A resolution has been submitted and is awaiting auditor review. It is not yet closed.</Alert>}

            <h4>Issue description</h4>
            {ex.issueDescription && issue === null && <p className="prewrap">{ex.issueDescription}</p>}
            {!ex.issueDescription && issue === null && <p className="muted">No issue description recorded.</p>}
            {editable && (can("exceptions.comment") || can("exceptions.resolve")) && (
              issue === null ? (
                <button className="btn btn-sm" onClick={() => setIssue(ex.issueDescription ?? "")}>{ex.issueDescription ? "Update" : "Add"} issue description</button>
              ) : (
                <div className="stack">
                  <textarea rows={3} value={issue} onChange={(e) => setIssue(e.target.value)} maxLength={2000} />
                  <div className="row">
                    <button className="btn btn-primary btn-sm" disabled={busy || !issue.trim()} onClick={() => act(`/exceptions/${exId}/issue`, { description: issue }, "Issue description saved.", () => setIssue(null))}>Save</button>
                    <button className="btn btn-sm" onClick={() => setIssue(null)}>Cancel</button>
                  </div>
                </div>
              )
            )}
          </div>

          {editable && can("exceptions.assign") && (
            <div className="section">
              <h4>Follow-up owner</h4>
              <FollowUpPicker current={ex.followUp} busy={busy} onAssign={(name, userId) => act(`/exceptions/${exId}/assign`, { name, userId }, "Follow-up person updated.")} />
              {ex.assignments.length > 0 && (
                <ul className="plain muted">
                  {ex.assignments.map((a: any) => <li key={a.id}>{fmtDateTime(a.assignedAt)} — {a.previous ? `${a.previous} → ` : ""}<b>{a.name}</b> (by {a.assignedBy})</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="section">
            <h4>Comments ({ex.comments.length})</h4>
            {ex.comments.length === 0 && <p className="muted">No comments yet.</p>}
            <ul className="thread">
              {ex.comments.map((c: any) => (
                <li key={c.id}><div className="thread-meta"><b>{c.author}</b> <Badge>{c.role}</Badge> <span className="muted">{fmtDateTime(c.createdAt)}</span></div><div className="prewrap">{c.body}</div></li>
              ))}
            </ul>
            {editable && can("exceptions.comment") && (
              <div className="stack">
                <textarea rows={3} placeholder="Add a comment. Comments are permanent and cannot be edited or deleted." value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
                <div><button className="btn btn-primary btn-sm" disabled={busy || !comment.trim()} onClick={() => act(`/exceptions/${exId}/comments`, { body: comment }, "Comment added.", () => setComment(""))}>Add comment</button></div>
              </div>
            )}
          </div>

          <div className="section">
            <h4>Resolution</h4>
            {ex.resolutions.length === 0 && <p className="muted">Not submitted.</p>}
            <ul className="thread">
              {ex.resolutions.map((r: any) => (
                <li key={r.id}>
                  <div className="thread-meta"><b>{r.submittedBy}</b> <Badge>{r.role}</Badge> <span className="muted">{fmtDateTime(r.submittedAt)}</span></div>
                  <div className="prewrap">{r.explanation}</div>
                  {r.evidence && <div className="muted">Evidence / reference: {r.evidence}</div>}
                </li>
              ))}
            </ul>
            {can("exceptions.resolve") && ["open", "reopened", "investigating"].includes(st!) && (
              <div className="stack">
                {["open", "reopened"].includes(st!) && (
                  <div><button className="btn btn-sm" disabled={busy} onClick={() => act(`/exceptions/${exId}/start`, {}, "Marked as investigating.")}>Start investigation</button></div>
                )}
                <textarea rows={3} placeholder="Describe the action taken to resolve this exception…" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={4000} />
                <input placeholder="Evidence reference (optional) — e.g. ticket number, statement reference" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} />
                <div>
                  <button className="btn btn-primary btn-sm" disabled={busy || !explanation.trim()} onClick={() => act(`/exceptions/${exId}/resolve`, { explanation, evidence }, "Resolution submitted for auditor review.", () => { setExplanation(""); setEvidence(""); })}>Submit resolution</button>
                  <span className="muted"> Submitting a resolution does not close the case — an Internal Auditor must review it.</span>
                </div>
              </div>
            )}
          </div>

          {((st === "resolution_submitted" && canClose) || (st === "closed" && canReopen)) && (
            <div className="section section-audit">
              <h4>Auditor review</h4>
              <div className="stack">
                <textarea rows={3} placeholder={st === "closed" ? "Reason for reopening (required)" : "Closure note, or reason for returning the case (required)"} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
                <div className="row">
                  {st === "resolution_submitted" && (
                    <>
                      <button className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => act(`/exceptions/${exId}/close`, { note }, "Exception closed.", () => setNote(""))}>Verify & close</button>
                      <button className="btn" disabled={busy || !note.trim()} onClick={() => act(`/exceptions/${exId}/return`, { note }, "Returned for further work.", () => setNote(""))}>Return for rework</button>
                    </>
                  )}
                  {st === "closed" && <button className="btn btn-danger" disabled={busy || !note.trim()} onClick={() => act(`/exceptions/${exId}/reopen`, { note }, "Exception reopened.", () => setNote(""))}>Reopen</button>}
                </div>
              </div>
            </div>
          )}

          {ex.closures.length > 0 && (
            <div className="section">
              <h4>Auditor decisions</h4>
              <ul className="thread">
                {ex.closures.map((c: any) => (
                  <li key={c.id}><div className="thread-meta"><Badge tone={c.action === "closed" ? "green" : c.action === "reopened" ? "red" : "amber"}>{c.action}</Badge> <b>{c.user}</b> <Badge>{c.role}</Badge> <span className="muted">{fmtDateTime(c.createdAt)}</span></div><div className="prewrap">{c.note}</div></li>
                ))}
              </ul>
            </div>
          )}

          <details className="section" open>
            <summary>Comments and history ({ex.events.length} events)</summary>
            <ol className="timeline">
              {ex.events.map((e: any) => (
                <li key={e.id}>
                  <div><b>{EVENT_LABEL[e.type] ?? e.type}</b> {e.detail?.to && e.type.includes("assign") ? <>→ {e.detail.to}{e.detail.from ? ` (was ${e.detail.from})` : ""}</> : null}</div>
                  <div className="muted">{e.actor}{e.role ? ` (${e.role})` : ""} · {fmtDateTime(e.createdAt)}</div>
                  {e.type !== "comment" && e.detail?.note && <div className="prewrap small">{e.detail.note}</div>}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </Modal>
  );
}
