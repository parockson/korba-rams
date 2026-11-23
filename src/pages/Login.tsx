import { useState } from "react";
import { api, errMsg } from "../api";
import { Alert, Field } from "../ui";

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.post("/auth/login", { username, password }); onDone(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>RAMS</h1>
        <p className="muted">Reconciliation Audit Monitoring System</p>
        {error && <Alert>{error}</Alert>}
        <Field label="Username"><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={busy || !username || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

export function ChangePasswordPage({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setError("The new passwords do not match.");
    try { await api.post("/auth/change-password", { currentPassword: cur, newPassword: next }); onDone(); } catch (err) { setError(errMsg(err)); }
  };
  return (
    <div className={forced ? "login" : ""}>
      <form className="card login-card" onSubmit={submit}>
        <h2>{forced ? "Choose a new password" : "Change password"}</h2>
        {forced && <p className="muted">You must set a personal password before continuing.</p>}
        {error && <Alert>{error}</Alert>}
        <Field label="Current password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and a number"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Repeat new password"><input type="password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
        <button className="btn btn-primary" disabled={!cur || !next}>Save password</button>
      </form>
    </div>
  );
}
