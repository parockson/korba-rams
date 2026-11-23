import { useState } from "react";
import { useSession } from "./session";
import { Field, toggle } from "./ui";
import { EXC_STATUS_LABEL, TAGS, type Filters } from "./types";

export type FilterField = "transId" | "bulk" | "trans" | "recon" | "tags" | "terminators" | "excStatus" | "reconStatus" | "uploader" | "followUp" | "superseded";

export function FilterBar({
  value, onChange, fields, onApply, uploaders,
}: {
  value: Filters; onChange: (f: Filters) => void; fields: FilterField[]; onApply?: () => void; uploaders?: { id: number; fullName: string }[];
}) {
  const { session } = useSession();
  const [bulkOpen, setBulkOpen] = useState(!!value.transIds);
  const has = (f: FilterField) => fields.includes(f);
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <form className="filters" onSubmit={(e) => { e.preventDefault(); onApply?.(); }}>
      <div className="filter-grid">
        {has("transId") && (
          <Field label="Transaction ID" hint="Partial or exact match">
            <input value={value.transId ?? ""} onChange={(e) => set({ transId: e.target.value })} placeholder="e.g. MTN0012345" />
          </Field>
        )}
        {has("trans") && (
          <>
            <Field label="Trans Date from" hint="Date of the underlying transaction"><input type="date" value={value.transFrom ?? ""} onChange={(e) => set({ transFrom: e.target.value })} /></Field>
            <Field label="Trans Date to"><input type="date" value={value.transTo ?? ""} onChange={(e) => set({ transTo: e.target.value })} /></Field>
          </>
        )}
        {has("recon") && (
          <>
            <Field label="Recon Date from" hint="Date RAMS recorded the submission"><input type="date" value={value.reconFrom ?? ""} onChange={(e) => set({ reconFrom: e.target.value })} /></Field>
            <Field label="Recon Date to"><input type="date" value={value.reconTo ?? ""} onChange={(e) => set({ reconTo: e.target.value })} /></Field>
          </>
        )}
        {has("followUp") && (
          <Field label="Follow-up person"><input value={value.followUp ?? ""} onChange={(e) => set({ followUp: e.target.value })} /></Field>
        )}
        {has("reconStatus") && (
          <Field label="Reconciliation status">
            <select value={value.reconStatusIds?.[0] ?? ""} onChange={(e) => set({ reconStatusIds: e.target.value ? [Number(e.target.value)] : undefined })}>
              <option value="">All</option>
              {session.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        {has("uploader") && uploaders && (
          <Field label="Uploaded by">
            <select value={value.uploaderIds?.[0] ?? ""} onChange={(e) => set({ uploaderIds: e.target.value ? [Number(e.target.value)] : undefined })}>
              <option value="">All</option>
              {uploaders.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </Field>
        )}
      </div>
      {has("tags") && (
        <div className="chips" role="group" aria-label="Tag">
          <span className="field-label">Tag</span>
          {TAGS.map((t) => (
            <label key={t} className={`chip ${value.tags?.includes(t) ? "chip-on" : ""}`}>
              <input type="checkbox" checked={!!value.tags?.includes(t)} onChange={() => { const n = toggle(value.tags, t); set({ tags: n.length ? n : undefined }); }} />{t}
            </label>
          ))}
        </div>
      )}
      {has("terminators") && (
        <div className="chips" role="group" aria-label="Terminator">
          <span className="field-label">Terminator</span>
          {session.terminators.map((t) => (
            <label key={t.id} className={`chip ${value.terminatorIds?.includes(t.id) ? "chip-on" : ""}`}>
              <input type="checkbox" checked={!!value.terminatorIds?.includes(t.id)} onChange={() => { const n = toggle(value.terminatorIds, t.id); set({ terminatorIds: n.length ? n : undefined }); }} />{t.name}{!t.isActive && " (inactive)"}
            </label>
          ))}
        </div>
      )}
      {has("excStatus") && (
        <div className="chips" role="group" aria-label="Exception status">
          <span className="field-label">Exception status</span>
          {Object.entries(EXC_STATUS_LABEL).map(([k, label]) => (
            <label key={k} className={`chip ${value.exceptionStatus?.includes(k) ? "chip-on" : ""}`}>
              <input type="checkbox" checked={!!value.exceptionStatus?.includes(k)} onChange={() => { const n = toggle(value.exceptionStatus, k); set({ exceptionStatus: n.length ? n : undefined }); }} />{label}
            </label>
          ))}
        </div>
      )}
      {has("bulk") && (
        <div>
          <button type="button" className="link" onClick={() => setBulkOpen(!bulkOpen)}>{bulkOpen ? "Hide" : "Search"} multiple transaction IDs (paste a list)</button>
          {bulkOpen && (
            <textarea rows={4} placeholder="Paste IDs separated by new lines, commas or spaces" value={value.transIds ?? ""} onChange={(e) => set({ transIds: e.target.value })} />
          )}
        </div>
      )}
      <div className="row between">
        {has("superseded") ? (
          <label className="check"><input type="checkbox" checked={!!value.includeSuperseded} onChange={(e) => set({ includeSuperseded: e.target.checked })} /> Include superseded (corrected) batch versions</label>
        ) : <span />}
        <div className="row">
          <button type="button" className="btn" onClick={() => { onChange({}); setBulkOpen(false); }}>Clear</button>
          {onApply && <button className="btn btn-primary" type="submit">Apply filters</button>}
        </div>
      </div>
    </form>
  );
}

/** Strip UI-only shapes before sending to the API (bulk IDs are free text in the UI). */
export const cleanFilters = (f: Filters) => {
  const out: any = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === "" || v === undefined || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
};
