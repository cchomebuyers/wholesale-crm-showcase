// dnc_records.test.js — persisted DNC verdicts, deny-by-default under staleness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createDncStore, normalizePhone, MAX_AGE_DAYS } from "./dnc_records.js";

const store = () => createDncStore(new DatabaseSync(":memory:"));

test("normalizePhone: formats collapse to 10 digits; garbage rejected", () => {
  assert.equal(normalizePhone("(313) 555-0100"), "3135550100");
  assert.equal(normalizePhone("+1 313 555 0100"), "3135550100");
  assert.equal(normalizePhone("13135550100"), "3135550100");
  assert.equal(normalizePhone("555-0100"), null);
  assert.equal(normalizePhone(""), null);
});

test("record + lookup round-trip with source attribution", () => {
  const s = store();
  const r = s.record({ phone: "(313) 555-0100", status: "clear", source: "federal-dnc", channels: ["call"] });
  assert.ok(r.ok);
  const hit = s.lookup("3135550100");
  assert.equal(hit.effective_status, "clear");
  assert.equal(hit.source, "federal-dnc");
  assert.deepEqual(hit.channels, ["call"]);
});

test("verdicts REQUIRE a source — unattributed results are rejected", () => {
  assert.equal(store().record({ phone: "3135550100", status: "clear", source: "" }).ok, false);
});

test("invalid status / phone rejected", () => {
  const s = store();
  assert.equal(s.record({ phone: "3135550100", status: "fine", source: "x" }).ok, false);
  assert.equal(s.record({ phone: "911", status: "clear", source: "x" }).ok, false);
});

test("a stale clear degrades to UNCHECKED (deny-by-default wins)", () => {
  const s = store();
  s.record({ phone: "3135550100", status: "clear", source: "federal-dnc" });
  const future = Date.now() + (MAX_AGE_DAYS + 5) * 864e5;
  const hit = s.lookup("3135550100", { now: future });
  assert.equal(hit.stale, true);
  assert.equal(hit.effective_status, null, "stale clear must not authorize a call");
});

test("listed/refused NEVER expire", () => {
  const s = store();
  s.record({ phone: "3135550100", status: "listed", source: "federal-dnc" });
  const farFuture = Date.now() + 365 * 864e5;
  assert.equal(s.lookup("3135550100", { now: farFuture }).effective_status, "listed");
});

test("re-check overwrites (fresh verdict replaces old)", () => {
  const s = store();
  s.record({ phone: "3135550100", status: "listed", source: "federal-dnc" });
  s.record({ phone: "3135550100", status: "clear", source: "provider:batchdata" });
  assert.equal(s.lookup("3135550100").effective_status, "clear");
});

test("statusMap: fresh clears + permanent listings included, stale clears dropped", () => {
  const s = store();
  s.record({ phone: "3135550100", status: "clear", source: "x" });
  s.record({ phone: "3135550101", status: "listed", source: "x" });
  const future = Date.now() + (MAX_AGE_DAYS + 1) * 864e5;
  const m = s.statusMap({ now: future });
  assert.equal(m.has("3135550100"), false, "stale clear dropped");
  assert.equal(m.get("3135550101"), "listed");
});
