import { SessionProvider, useBootstrap, useRoute, useSession } from "./session";
import { Alert } from "./ui";
import { LoginPage, ChangePasswordPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { NewReconPage } from "./pages/NewRecon";
import { BatchesPage } from "./pages/Batches";
import { SearchPage } from "./pages/Search";
import { ReportsPage } from "./pages/Reports";
import { AuditPage } from "./pages/Audit";
import { AdminPage } from "./pages/Admin";

function Shell() {
  const { session, can, logout } = useSession();
  const { path, query } = useRoute();
  const nav: [string, string, boolean][] = [
    ["/", "Dashboard", can("dashboard.view")],
    ["/new", "New reconciliation", can("recon.create")],
    ["/batches", "Reconciliations", can("recon.view")],
    ["/search", "Search", can("recon.view")],
    ["/exceptions", "Exceptions", can("exceptions.view")],
    ["/reports", "Reports", can("reports.export")],
    ["/audit", "Audit trail", can("audit.view")],
    ["/admin", "Administration", can("users.manage") || can("roles.manage") || can("terminators.manage") || can("settings.manage")],
    ["/password", "Change password", true],
  ];
  const allowed = nav.filter((n) => n[2]);
  const initial = () => ({
    ...(query.batch ? { batchId: Number(query.batch) } : {}),
    ...(query.id ? { transId: query.id } : {}),
  });
  const current = allowed.find((n) => n[0] === path) ?? allowed[0];
  let page;
  switch (current?.[0]) {
    case "/": page = <DashboardPage />; break;
    case "/new": page = <NewReconPage />; break;
    case "/batches": page = <BatchesPage openId={query.open ? Number(query.open) : undefined} />; break;
    case "/search": page = <SearchPage key={JSON.stringify(query)} mode="search" initial={initial()} />; break;
    case "/exceptions": page = <SearchPage key={JSON.stringify(query)} mode="exceptions" initial={initial()} />; break;
    case "/reports": page = <ReportsPage />; break;
    case "/audit": page = <AuditPage />; break;
    case "/admin": page = <AdminPage />; break;
    case "/password": page = <ChangePasswordPage onDone={() => (window.location.hash = "/")} />; break;
    default: page = <Alert tone="amber">Your account has no permissions assigned yet. Ask an administrator for a role.</Alert>;
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">RAMS<small>Reconciliation Audit Monitoring</small></div>
        <nav>{allowed.map(([p, label]) => <a key={p} href={`#${p}`} className={current?.[0] === p ? "active" : ""}>{label}</a>)}</nav>
        <div className="me">
          <b>{session.user.fullName}</b>
          <span>{session.user.roles.map((r) => r.name).join(", ") || "No role"}</span>
          <button className="btn btn-sm" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">{page}</main>
    </div>
  );
}

export default function App() {
  const { session, loading, error, refresh, logout } = useBootstrap();
  if (loading) return <div className="login"><p className="muted">Loading…</p></div>;
  if (error) return <div className="login"><Alert>{error}</Alert></div>;
  if (!session) return <LoginPage onDone={refresh} />;
  if (session.user.mustChangePassword) return <ChangePasswordPage forced onDone={refresh} />;
  return <SessionProvider session={session} refresh={refresh} logout={logout}><Shell /></SessionProvider>;
}
