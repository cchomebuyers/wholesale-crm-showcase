// route_engine.test.js — the kernel gate. Proves capabilities + routes + threading + planner + gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouteEngine } from "./route_engine.js";

function demoEngine() {
  const e = createRouteEngine();
  e.registerCapability({ id: "normalize_address", cost: { money: 0, latency_ms: 5 },
    policy: { legal_status: "n/a" }, run: (_c, addr) => String(addr || "").toUpperCase() });
  e.registerCapability({ id: "resolve_owner", cost: { money: 0, latency_ms: 50 },
    policy: { legal_status: "public_official_api", risk: 0 },
    run: (_c, addr) => (addr ? { owner_name: "ACME LLC", from: addr } : null) });
  e.registerCapability({ id: "find_contact", cost: { money: 0, latency_ms: 80 },
    policy: { legal_status: "public_official_api", risk: 1 },
    run: (_c, owner) => (owner ? { phone: "3135550100", outreach_allowed: false } : null) });
  e.registerCapability({ id: "compliance_gate", cost: { money: 0, latency_ms: 1 },
    policy: { legal_status: "policy", risk: 0 },
    run: (_c, cand) => ({ ...cand, compliance_status: "checked", outreach_allowed: false, reason: "DNC not subscribed" }) });
  e.registerRoute({
    id: "address_to_contact", goal: "find_contact", domain: "real_estate", confidence: 0.8, value: 0.9,
    output: "gated",
    steps: [
      { capability: "normalize_address", input: "target.address", output: "addr" },
      { capability: "resolve_owner", input: "addr", output: "owner" },
      { capability: "find_contact", input: "owner", output: "candidate" },
      { capability: "compliance_gate", input: "candidate", output: "gated" },
    ],
  });
  return e;
}

test("runRoute threads outputs into later step inputs", async () => {
  const e = demoEngine();
  const r = await e.runRoute("address_to_contact", { address: "1 main st" });
  assert.equal(r.vars.addr, "1 MAIN ST");
  assert.equal(r.vars.owner.owner_name, "ACME LLC");
  assert.equal(r.result.phone, "3135550100");
});

test("every step is recorded in the evidence ledger with provenance", async () => {
  const e = demoEngine();
  const r = await e.runRoute("address_to_contact", { address: "1 main st" });
  assert.equal(r.evidence.length, 4);
  assert.ok(r.evidence.every((ev) => ev.status === "ok" && "legal_status" in ev));
});

test("compliance gate keeps the final candidate non-callable until checked", async () => {
  const e = demoEngine();
  const r = await e.runRoute("address_to_contact", { address: "1 main st" });
  assert.equal(r.result.compliance_status, "checked");
  assert.equal(r.result.outreach_allowed, false);
});

test("a required step error halts the route; evidence captures it", async () => {
  const e = demoEngine();
  e.registerCapability({ id: "boom", run: () => { throw new Error("nope"); } });
  e.registerRoute({ id: "broken", goal: "x", steps: [
    { capability: "boom", input: "target", output: "y", required: true },
    { capability: "normalize_address", input: "target.address", output: "z" },
  ] });
  const r = await e.runRoute("broken", { address: "a" });
  assert.equal(r.evidence[0].status, "error");
  assert.equal(r.vars.z, undefined); // halted before step 2
});

test("missing capability is reported, not thrown", async () => {
  const e = createRouteEngine();
  e.registerRoute({ id: "r", steps: [{ capability: "ghost", input: "target" }] });
  const r = await e.runRoute("r", {});
  assert.equal(r.steps[0].status, "missing_capability");
});

test("planner ranks routes for a goal and flags non-runnable ones", () => {
  const e = demoEngine();
  e.registerRoute({ id: "needs_paid", goal: "find_contact", confidence: 0.95, value: 0.9, steps: [
    { capability: "skiptrace_paid", input: "target" }, // not registered
  ] });
  const ranked = e.plan("find_contact");
  assert.ok(ranked.length >= 2);
  assert.ok(ranked.some((r) => r.route === "address_to_contact" && r.runnable));
  const paid = ranked.find((r) => r.route === "needs_paid");
  assert.equal(paid.runnable, false);
  assert.deepEqual(paid.missing, ["skiptrace_paid"]);
});

test("literal input escape works (=value)", async () => {
  const e = createRouteEngine();
  e.registerCapability({ id: "echo", run: (_c, v) => v });
  e.registerRoute({ id: "lit", steps: [{ capability: "echo", input: "=hello", output: "out" }] });
  const r = await e.runRoute("lit", {});
  assert.equal(r.vars.out, "hello");
});
