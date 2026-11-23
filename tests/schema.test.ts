import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROLES, MIGRATIONS, PERMISSIONS } from "../netlify/lib/schema";

test("only auditor roles hold close/reopen by default", () => {
  for (const r of DEFAULT_ROLES) {
    const holds = r.permissions.some((p) => p === "exceptions.close" || p === "exceptions.reopen");
    assert.equal(holds, r.isAuditor, r.name);
  }
});
test("default roles reference known permissions", () => {
  const known = new Set(PERMISSIONS.map((p) => p[0]));
  for (const r of DEFAULT_ROLES) for (const p of r.permissions) assert.ok(known.has(p), p);
});
test("every migration statement is a single statement", () => {
  for (const m of MIGRATIONS) for (const s of m.statements) assert.ok(!/;\s*\S/.test(s.replace(/\$\$[\s\S]*?\$\$/g, "")), s.slice(0, 60));
});
