// parse_memory.test.js — the memory-first parse resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { signatureOf, detectKind, createParseMemory } from "./parse_memory.js";

const RE_RECORD = { address: "9 Oak Ave", owner_name: "Jane", parcel_id: "123", arv: 1 };
const SMB_RECORD = { business_name: "Acme LLC", website: "acme.com", license_id: "L-9", phone: "313" };

test("signature is shape-only: same fields any order/values -> same signature", () => {
  const a = signatureOf({ b: 1, a: 2 });
  const b = signatureOf({ a: 99, b: "zz" });
  assert.equal(a, b);
  assert.notEqual(a, signatureOf({ a: 1, c: 2 }));
});

test("signature never contains field values (no PII in memory)", () => {
  const sig = signatureOf({ seller_phone: "3135550100" });
  assert.ok(!sig.includes("3135550100"));
});

test("detectKind picks smb for business-shaped records", () => {
  const d = detectKind(SMB_RECORD);
  assert.equal(d.kind, "smb");
  assert.ok(d.matched.includes("business_name"));
});

test("detectKind returns null when nothing overlaps", () => {
  assert.equal(detectKind({ zzz: 1, qqq: 2 }), null);
});

test("resolve: first call detects + remembers, second call hits memory", () => {
  const pm = createParseMemory(new DatabaseSync(":memory:"));
  const first = pm.resolve(SMB_RECORD);
  assert.equal(first.source, "detected");
  assert.equal(first.kind, "smb");
  const second = pm.resolve({ ...SMB_RECORD, business_name: "Different Co" });
  assert.equal(second.source, "memory", "same shape -> memory hit");
  assert.equal(second.kind, "smb");
  assert.equal(second.hits, 1);
});

test("memory survives across memory-unit instances on the same db", () => {
  const db = new DatabaseSync(":memory:");
  createParseMemory(db).resolve(RE_RECORD);
  const again = createParseMemory(db).resolve(RE_RECORD);
  assert.equal(again.source, "memory");
});

test("remember/forget round-trip with explicit config", () => {
  const pm = createParseMemory(new DatabaseSync(":memory:"));
  const sig = signatureOf(RE_RECORD);
  pm.remember(sig, "realEstate", { note: "manual pin" });
  const hit = pm.recall(sig);
  assert.equal(hit.kind, "realEstate");
  assert.equal(hit.config.note, "manual pin");
  pm.forget(sig);
  assert.equal(pm.recall(sig), null);
});

test("manual remember overrides prior detection (operator corrects the parser)", () => {
  const pm = createParseMemory(new DatabaseSync(":memory:"));
  const r = pm.resolve(SMB_RECORD);
  assert.equal(r.kind, "smb");
  pm.remember(r.signature, "realEstate", { pinned: true });
  const after = pm.resolve(SMB_RECORD);
  assert.equal(after.kind, "realEstate");
  assert.equal(after.source, "memory");
});

test("stats aggregates shapes and hits per kind", () => {
  const pm = createParseMemory(new DatabaseSync(":memory:"));
  pm.resolve(SMB_RECORD); pm.resolve(SMB_RECORD); pm.resolve(RE_RECORD);
  const s = pm.stats();
  assert.ok(s.find((x) => x.kind === "smb"));
  const smb = s.find((x) => x.kind === "smb");
  assert.equal(smb.shapes, 1);
  assert.equal(smb.hits, 1);
});
