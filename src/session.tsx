import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "./api";
import { setTimezone } from "./format";
import type { Session } from "./types";

interface Ctx {
  session: Session;
  can: (perm: string) => boolean;
  canClose: boolean;
  canReopen: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("No session");
  return c;
};

export function SessionProvider({ session, refresh, logout, children }: { session: Session; refresh: () => Promise<void>; logout: () => Promise<void>; children: ReactNode }) {
  const { user } = session;
  const can = (p: string) => user.permissions.includes(p);
  // mirrors the server rule: close/reopen only via an auditor-flagged role holding the permission
  const viaAuditor = (p: string) => user.roles.some((r) => r.isAuditor && r.permissions.includes(p));
  return (
    <SessionCtx.Provider value={{ session, can, canClose: viaAuditor("exceptions.close"), canReopen: viaAuditor("exceptions.reopen"), refresh, logout }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useBootstrap() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const s = await api.get("/auth/me");
      setTimezone(s.timezone);
      setSession(s);
      setError(null);
    } catch (e: any) {
      setSession(null);
      if (e?.status && e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const h = () => setSession(null);
    window.addEventListener("rams:unauthenticated", h);
    return () => window.removeEventListener("rams:unauthenticated", h);
  }, [load]);
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setSession(null);
  };
  return { session, loading, error, refresh: load, logout, setSession };
}

/** Minimal hash router: "#/search?batch=3" */
export function useRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#/, "") || "/";
    const [path, qs = ""] = h.split("?");
    return { path, query: Object.fromEntries(new URLSearchParams(qs)) as Record<string, string> };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const h = () => setRoute(parse());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return route;
}
export const go = (path: string) => {
  window.location.hash = path;
};
