import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { useSession } from "../session";
import { Alert, Badge, Field, Modal, toggle, useToast } from "../ui";
import { fmtDateTime } from "../format";

function useList(path: string, key: string) {
  const [rows, setRows] = useState<any[]>([]);
  const [extra, setExtra] = useState<any>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await api.get(path); setRows(r[key]); setExtra(r); setError(null); } catch (e) { setError(errMsg(e)); }
  }, [path, key]);
  useEffect(() => { load(); }, [load]);
  return { rows, extra, error, load };
}

function UsersTab() {
  const { session, refresh } = useSession();
  const users = useList("/users", "users");
  const roles = useList("/roles", "roles");
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const save = async () => {
    setErr(null);
    try {
      const b = { fullName: edit.fullName, email: edit.email || null, roleIds: edit.roleIds, terminatorScope: edit.terminatorScope, isActive: edit.isActive };
      if (edit.id) await api.put(`/users/${edit.id}`, b); else await api.post("/users", { ...b, username: edit.username, password: edit.password });
      setEdit(null); users.load(); refresh(); toast.show("User saved.");
    } catch (e) { setErr(errMsg(e)); }
  };
  const reset = async (u: any) => {
    const password = window.prompt(`New temporary password for ${u.username} (min 10 chars, letters + number). They must change it at next sign-in.`);
    if (!password) return;
    try { await api.post(`/users/${u.id}/reset-password`, { password }); toast.show("Password reset."); } catch (e) { toast.show(errMsg(e), "red"); }
  };
  return (
    <>
      {toast.node}{users.error && <Alert>{users.error}</Alert>}
      <div className="row between"><p className="muted">Users with no terminators selected can see all terminators.</p>
        <button className="btn btn-primary" onClick={() => setEdit({ fullName: "", username: "", password: "", email: "", roleIds: [], terminatorScope: [], isActive: true })}>＋ Add user</button></div>
      <table className="table"><thead><tr><th>Name</th><th>Username</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>{users.rows.map((u) => (
          <tr key={u.id}><td>{u.fullName}</td><td>{u.username}</td><td>{u.roleNames.join(", ") || "—"}</td><td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td>{fmtDateTime(u.lastLoginAt)}</td>
            <td className="row"><button className="btn btn-sm" onClick={() => setEdit({ ...u })}>Edit</button><button className="btn btn-sm" onClick={() => reset(u)}>Reset password</button></td></tr>))}</tbody></table>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.username}` : "Add user"} onClose={() => setEdit(null)}>
          {err && <Alert>{err}</Alert>}
          <div className="stack">
            <Field label="Full name"><input value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
            {!edit.id && <><Field label="Username"><input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
              <Field label="Temporary password" hint="Min 10 characters with letters and a number; changed at first sign-in"><input type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field></>}
            <Field label="Email (optional)"><input value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <div><span className="field-label">Roles</span>{roles.rows.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={edit.roleIds.includes(r.id)} onChange={() => setEdit({ ...edit, roleIds: toggle(edit.roleIds, r.id) })} />{r.name}{r.isAuditor && <Badge tone="teal">auditor</Badge>}</label>)}</div>
            <div><span className="field-label">Restrict to terminators (optional)</span>{session.terminators.map((t) => <label key={t.id} className="check"><input type="checkbox" checked={(edit.terminatorScope ?? []).includes(t.id)} onChange={() => setEdit({ ...edit, terminatorScope: toggle(edit.terminatorScope ?? [], t.id) })} />{t.name}</label>)}</div>
            {edit.id && <label className="check"><input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Account active</label>}
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function RolesTab() {
  const roles = useList("/roles", "roles");
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const groups: Record<string, any[]> = {};
  (roles.extra.permissions ?? []).forEach((p: any) => (groups[p.group] ??= []).push(p));
  const save = async () => {
    setErr(null);
    try { edit.id ? await api.put(`/roles/${edit.id}`, edit) : await api.post("/roles", edit); setEdit(null); roles.load(); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <>
      {roles.error && <Alert>{roles.error}</Alert>}
      <div className="row between"><p className="muted">Permissions are enforced on the server. Close/reopen can only be held by roles marked as auditor roles.</p>
        <button className="btn btn-primary" onClick={() => setEdit({ name: "", description: "", isAuditor: false, permissions: [] })}>＋ Add role</button></div>
      <table className="table"><thead><tr><th>Role</th><th>Users</th><th>Permissions</th><th /></tr></thead>
        <tbody>{roles.rows.map((r) => <tr key={r.id}><td><b>{r.name}</b> {r.isAuditor && <Badge tone="teal">auditor</Badge>}<div className="muted small">{r.description}</div></td><td>{r.userCount}</td><td className="small">{r.permissions.length} granted</td><td><button className="btn btn-sm" onClick={() => setEdit({ ...r })}>Edit</button></td></tr>)}</tbody></table>
      {edit && (
        <Modal wide title={edit.id ? `Edit role: ${edit.name}` : "Add role"} onClose={() => setEdit(null)}>
          {err && <Alert>{err}</Alert>}
          <div className="stack">
            <Field label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Description"><input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={edit.isAuditor} onChange={(e) => setEdit({ ...edit, isAuditor: e.target.checked })} /> Internal Auditor role (may hold close / reopen permissions)</label>
            {Object.entries(groups).map(([g, ps]) => (
              <div key={g}><span className="field-label">{g}</span>
                {ps.map((p) => <label key={p.key} className="check"><input type="checkbox" checked={edit.permissions.includes(p.key)} onChange={() => setEdit({ ...edit, permissions: toggle(edit.permissions, p.key) })} /><span><b>{p.key}</b> — {p.description}</span></label>)}</div>
            ))}
            <button className="btn btn-primary" onClick={save}>Save role</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function SimpleTab({ path, listKey, label, withCode }: { path: string; listKey: string; label: string; withCode?: boolean }) {
  const { refresh } = useSession();
  const list = useList(path, listKey);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    try { await api.post(path, { name, code }); setName(""); setCode(""); list.load(); refresh(); } catch (e) { setErr(errMsg(e)); }
  };
  const patch = async (id: number, body: any) => { try { await api.put(`${path}/${id}`, body); list.load(); refresh(); } catch (e) { setErr(errMsg(e)); } };
  return (
    <>
      {(err || list.error) && <Alert>{err ?? list.error}</Alert>}
      <div className="row">{withCode && <input placeholder="Identifier (e.g. MTN_DIRECT)" value={code} onChange={(e) => setCode(e.target.value)} />}<input placeholder={`New ${label} name`} value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-primary" disabled={!name.trim()} onClick={add}>Add</button></div>
      <table className="table"><thead><tr>{withCode && <th>Identifier</th>}<th>Name</th>{withCode && <th>Batches</th>}<th>Active</th><th /></tr></thead>
        <tbody>{list.rows.map((r) => (
          <tr key={r.id}>{withCode && <td>{r.code}</td>}<td>{r.name}</td>{withCode && <td>{r.batchCount}</td>}<td>{r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
            <td className="row"><button className="btn btn-sm" onClick={() => { const n = window.prompt("Display name", r.name); if (n?.trim()) patch(r.id, { name: n }); }}>Rename</button>
              <button className="btn btn-sm" onClick={() => patch(r.id, { isActive: !r.isActive })}>{r.isActive ? "Deactivate" : "Activate"}</button></td></tr>))}</tbody></table>
      {withCode && <p className="muted small">Terminators with history cannot be deleted. Deactivating stops new submissions but keeps all historical data.</p>}
    </>
  );
}

export function AdminPage() {
  const { can } = useSession();
  const tabs = [
    can("users.manage") && "Users", can("roles.manage") && "Roles", can("terminators.manage") && "Terminators", can("settings.manage") && "Reconciliation statuses",
  ].filter(Boolean) as string[];
  const [tab, setTab] = useState(tabs[0]);
  return (
    <>
      <div className="page-head"><div><h1>Administration</h1></div></div>
      <div className="tabs">{tabs.map((t) => <button key={t} className={`tab ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="card">
        {tab === "Users" && <UsersTab />}
        {tab === "Roles" && <RolesTab />}
        {tab === "Terminators" && <SimpleTab path="/terminators" listKey="terminators" label="terminator" withCode />}
        {tab === "Reconciliation statuses" && <SimpleTab path="/recon-statuses" listKey="statuses" label="status" />}
      </div>
    </>
  );
}
