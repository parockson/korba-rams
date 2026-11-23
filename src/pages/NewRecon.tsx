import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api";
import { useSession, go } from "../session";
import { Alert, Field, Stat, TagBadge } from "../ui";
import { fmtBytes, fmtDate, pct } from "../format";

const TEMPLATE = "Trans Date,Trans ID,Tag\n2026-11-15,MTN0012345,F2S\n2026-11-16,MTN0012346,P2S\n2026-11-17,MTN0012347,S2F\n2026-11-18,MTN0012348,P2F\n";

export function NewReconPage() {
  const { session } = useSession();
  const active = session.terminators.filter((t) => t.isActive);
  const statuses = session.statuses.filter((s) => s.isActive);
  const [preview, setPreview] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminatorId, setTerminatorId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [check, setCheck] = useState<any>(null);
  const [asCorrection, setAsCorrection] = useState(false);
  const [correctsId, setCorrectsId] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null); setError(null); setTerminatorId(""); setStatusId(""); setRemarks(""); setCheck(null);
    setAsCorrection(false); setCorrectsId(""); setReason(""); setAck(false); setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    if (file.size > session.maxUploadBytes) return setError(`That file is ${fmtBytes(file.size)}; the limit is ${fmtBytes(session.maxUploadBytes)}.`);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setPreview(await api.upload("/recon/preview", fd));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    setCheck(null);
    setAsCorrection(false);
    setCorrectsId("");
    if (!terminatorId) return;
    api.get(`/recon/check?terminatorId=${terminatorId}`).then((c) => {
      setCheck(c);
      if (c.existingToday) { setAsCorrection(true); setCorrectsId(String(c.existingToday.id)); }
    }).catch(() => {});
  }, [terminatorId]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setDone(await api.post("/recon/submit", {
        uploadToken: preview.uploadToken, terminatorId: Number(terminatorId), statusId: Number(statusId), officerRemarks: remarks,
        acknowledgeRejected: ack, correctsBatchId: asCorrection ? Number(correctsId) : undefined, correctionReason: asCorrection ? reason : undefined,
      }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <>
        <h1>Reconciliation submitted</h1>
        <div className="card">
          <Alert tone="green">Batch <b>{done.reference}</b> was recorded with Recon Date <b>{fmtDate(done.reconDate)}</b>.</Alert>
          <div className="stats">
            <Stat label="Transactions imported" value={done.transactionCount.toLocaleString()} />
            <Stat label="Exceptions created" value={done.exceptionCount.toLocaleString()} tone={done.exceptionCount ? "red" : undefined} />
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => go(`/exceptions?batch=${done.id}`)}>View exceptions from this batch</button>
            <button className="btn" onClick={() => go("/batches")}>All reconciliations</button>
            <button className="btn" onClick={reset}>Submit another</button>
          </div>
        </div>
      </>
    );
  }

  const s = preview?.summary;
  const blocked = !!preview?.fatal?.length || !s?.total;
  const needAck = (preview?.rejectedTotal ?? 0) > 0;
  const canSubmit = preview && !blocked && terminatorId && statusId && (!needAck || ack) && (!asCorrection || (correctsId && reason.trim().length >= 5)) && !submitting && !(check?.existingToday && !asCorrection);

  return (
    <>
      <div className="page-head">
        <div><h1>New reconciliation</h1><p className="muted">Upload the transaction file, review the validation preview, then choose the terminator and status and submit.</p></div>
      </div>
      {error && <Alert>{error}</Alert>}

      <div className="card">
        <h3>1. Upload file</h3>
        <p className="muted">Accepted: .xlsx, .xls, .csv with exactly these columns: <b>Trans Date</b>, <b>Trans ID</b>, <b>Tag</b> (P2S, P2F, F2S, S2F). Do not include a Recon Date — RAMS generates it when you submit.{" "}
          <button className="link" onClick={() => {
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" })); a.download = "RAMS_template.csv"; a.click();
          }}>Download CSV template</button></p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => upload(e.target.files?.[0])} disabled={uploading} />
        {uploading && <p className="muted">Validating…</p>}
      </div>

      {preview && (
        <div className="card">
          <h3>2. Validation preview — {preview.file.name} <span className="muted">({fmtBytes(preview.file.size)})</span></h3>
          {preview.fatal.map((m: string) => <Alert key={m}>{m}</Alert>)}
          {preview.warnings.map((m: string) => <Alert key={m} tone="amber">{m}</Alert>)}
          {preview.sameFileSubmittedBefore.length > 0 && (
            <Alert tone="amber">An identical file was already submitted as {preview.sameFileSubmittedBefore.map((b: any) => `${b.reference} (${b.terminator}, ${fmtDate(b.reconDate)})`).join(", ")}.</Alert>
          )}
          {s && s.total + preview.rejectedTotal > 0 && (
            <div className="stats">
              <Stat label="Accepted rows" value={s.total.toLocaleString()} tone="green" />
              <Stat label="Rejected rows" value={preview.rejectedTotal.toLocaleString()} tone={preview.rejectedTotal ? "red" : undefined} />
              <Stat label="P2S" value={s.p2s.toLocaleString()} />
              <Stat label="P2F" value={s.p2f.toLocaleString()} />
              <Stat label="F2S" value={s.f2s.toLocaleString()} tone={s.f2s ? "red" : undefined} />
              <Stat label="S2F" value={s.s2f.toLocaleString()} tone={s.s2f ? "red" : undefined} />
              <Stat label="Exceptions to create" value={s.exceptions.toLocaleString()} sub={`${pct(s.exceptionPct)} of accepted`} tone={s.exceptions ? "red" : undefined} />
              <Stat label="Trans Date range" value={s.minDate ? `${fmtDate(s.minDate)} – ${fmtDate(s.maxDate)}` : "—"} />
            </div>
          )}
          {preview.rejectedTotal > 0 && (
            <details open>
              <summary><b>Row-level errors ({preview.rejectedTotal})</b>{preview.rejectedTotal > preview.rejected.length && ` — showing first ${preview.rejected.length}`}</summary>
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="table table-compact">
                  <thead><tr><th>Row</th><th>Trans Date</th><th>Trans ID</th><th>Tag</th><th>Problem</th></tr></thead>
                  <tbody>{preview.rejected.map((r: any) => <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.transDate}</td><td>{r.transId}</td><td>{r.tag}</td><td className="err">{r.errors.join("; ")}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="muted">Rejected rows are never silently dropped. Correct the file and upload it again, or confirm below that they are excluded and recorded on the batch.</p>
            </details>
          )}
          {preview.sample.length > 0 && (
            <details>
              <summary>Preview of accepted rows (first {preview.sample.length})</summary>
              <table className="table table-compact"><thead><tr><th>Row</th><th>Trans Date</th><th>Trans ID</th><th>Tag</th></tr></thead>
                <tbody>{preview.sample.map((r: any) => <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{fmtDate(r.transDate)}</td><td>{r.transId}</td><td><TagBadge tag={r.tag} /></td></tr>)}</tbody></table>
            </details>
          )}
          <div className="row"><button className="btn" onClick={reset}>Cancel and upload a different file</button></div>
        </div>
      )}

      {preview && !blocked && (
        <div className="card">
          <h3>3. Terminator, status and submit</h3>
          <div className="filter-grid">
            <Field label="Terminator *">
              <select value={terminatorId} onChange={(e) => setTerminatorId(e.target.value)}>
                <option value="">Select terminator…</option>
                {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Reconciliation status *" hint="Applies to the whole submission">
              <select value={statusId} onChange={(e) => setStatusId(e.target.value)}>
                <option value="">Select status…</option>
                {statuses.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Officer remarks (optional)"><textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={2000} /></Field>

          {check?.existingToday && (
            <Alert tone="amber">
              A reconciliation for this terminator has already been submitted today (<b>{check.existingToday.reference}</b>). A second submission must be recorded as a
              <b> correction</b> of that batch; the original and its history are preserved.
            </Alert>
          )}
          {check && (
            <label className="check"><input type="checkbox" checked={asCorrection} disabled={!!check.existingToday} onChange={(e) => { setAsCorrection(e.target.checked); if (!e.target.checked) setCorrectsId(""); }} /> This is a corrected report replacing an earlier submission</label>
          )}
          {asCorrection && (
            <div className="stack">
              <Field label="Batch being corrected *">
                <select value={correctsId} onChange={(e) => setCorrectsId(e.target.value)} disabled={!!check?.existingToday}>
                  <option value="">Select batch…</option>
                  {check.recent.map((b: any) => <option key={b.id} value={b.id}>{b.reference} v{b.version} · {fmtDate(b.reconDate)} · {b.filename}</option>)}
                </select>
              </Field>
              <Field label="Reason for correction *"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
            </div>
          )}
          {needAck && (
            <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand {preview.rejectedTotal} rejected row(s) are excluded from this submission and recorded on the batch.</label>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{submitting ? "Submitting…" : asCorrection ? "Submit correction" : "Submit reconciliation"}</button>
          </div>
        </div>
      )}
    </>
  );
}
