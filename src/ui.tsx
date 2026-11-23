import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXC_STATUS_LABEL } from "./types";

export function Badge({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "green" | "amber" | "red" | "blue" | "teal" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function TagBadge({ tag }: { tag: string }) {
  const tone = tag === "F2S" || tag === "S2F" ? "red" : tag === "P2S" ? "green" : "grey";
  return <Badge tone={tone}>{tag}</Badge>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="muted">No exception</span>;
  const tone = status === "closed" ? "green" : status === "resolution_submitted" ? "blue" : status === "investigating" ? "amber" : status === "reopened" ? "red" : "grey";
  return <Badge tone={tone}>{EXC_STATUS_LABEL[status] ?? status}</Badge>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "green" | "blue"; children: ReactNode }) {
  return <div className={`alert alert-${tone}`} role={tone === "red" ? "alert" : "status"}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="muted">
        {total === 0 ? "No records" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString("en-GB")}`}
      </span>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span className="muted">Page {page} / {pages}</span>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className={`stat ${tone ? "stat-" + tone : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Bars({ rows, empty = "No data for the selected filters." }: { rows: { label: string; value: number; extra?: ReactNode }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label" title={r.label}>{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bar-value">{r.value.toLocaleString("en-GB")}{r.extra}</span>
        </div>
      ))}
    </div>
  );
}

/** Toasts: lightweight, one at a time. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "green" | "red" } | null>(null);
  const timer = useRef<number>();
  const show = (text: string, tone: "green" | "red" = "green") => {
    setMsg({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  };
  const node = msg ? <div className={`toast toast-${msg.tone}`} role="status">{msg.text}</div> : null;
  return { show, node };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function toggle<T>(list: T[] | undefined, item: T): T[] {
  const l = list ?? [];
  return l.includes(item) ? l.filter((x) => x !== item) : [...l, item];
}
