import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseDate, validateTable } from "../netlify/lib/validate";

const csv = (s: string) => validateTable(parseCsv(s));

test("valid sample file reconciles and creates 2 exceptions", () => {
  const r = csv("Trans Date,Trans ID,Tag\n2026-11-15,MTN0012345,F2S\n2026-11-16,MTN0012346,P2S\n2026-11-17,MTN0012347,S2F\n2026-11-18,MTN0012348,P2F\n");
  assert.equal(r.fatal.length, 0);
  assert.deepEqual([r.summary.total, r.summary.p2s, r.summary.p2f, r.summary.f2s, r.summary.s2f, r.summary.exceptions], [4, 1, 1, 1, 1, 2]);
  assert.equal(r.summary.exceptionPct, 50);
  assert.equal(r.summary.minDate, "2026-11-15");
  assert.equal(r.summary.maxDate, "2026-11-18");
  assert.ok(r.summary.reconciles);
});

test("missing column is fatal", () => {
  assert.match(csv("Trans Date,Trans ID\n2026-11-15,A1").fatal[0], /Tag/);
});

test("tags are case-insensitive and trimmed; invalid tags rejected", () => {
  const r = csv("Trans Date,Trans ID,Tag\n2026-11-15,A1, f2s \n2026-11-15,A2,X9\n");
  assert.equal(r.accepted[0].tag, "F2S");
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].errors[0], /not valid/);
});

test("blank IDs, bad dates and in-file duplicates are flagged, never silently dropped", () => {
  const r = csv("Trans Date,Trans ID,Tag\n2026-11-15,,P2S\nnot-a-date,B1,P2S\n2026-11-15,C1,P2S\n2026-11-16,c1,P2F\n");
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.length, 3);
  assert.match(r.rejected[2].errors.join(), /Duplicate Trans ID \(first seen on row 4\)/);
});

test("leading zeros in IDs are preserved and whitespace trimmed", () => {
  const r = csv("Trans Date,Trans ID,Tag\n2026-11-15,  000123  ,P2S\n");
  assert.equal(r.accepted[0].transId, "000123");
});

test("extra columns are ignored with a warning", () => {
  const r = csv("Trans Date,Trans ID,Tag,Recon Date\n2026-11-15,A1,P2S,2026-11-19\n");
  assert.equal(r.accepted.length, 1);
  assert.match(r.warnings[0], /Recon Date/);
});

test("date parsing", () => {
  assert.equal(parseDate("2026-11-15"), "2026-11-15");
  assert.equal(parseDate("15/11/2026"), "2026-11-15");
  assert.equal(parseDate("15-Nov-2026"), "2026-11-15");
  assert.equal(parseDate(46341), "2026-11-15");
  assert.equal(parseDate("20261115"), "2026-11-15");
  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("garbage"), null);
});

test("csv parser handles quotes, BOM, semicolons", () => {
  assert.deepEqual(parseCsv('﻿a;b\n"x;1";"he said ""hi"""\n'), [["a", "b"], ["x;1", 'he said "hi"']]);
});

test("max rows enforced", () => {
  const rows = [["Trans Date", "Trans ID", "Tag"], ...Array.from({ length: 5 }, (_, i) => ["2026-11-15", `A${i}`, "P2S"])];
  assert.match(validateTable(rows, { maxRows: 3 }).fatal[0], /maximum/);
});
