// contact_router.test.js — the multi-route contact finder gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findContact } from "./contact_router.js";

// stub registry: one public-contact connector that returns a phone, one that returns nothing,
// and a non-contact connector that must be ignored.
const reg = (over = {}) => ({
  "stub-phone": {
    id: "stub-phone", type: "public-contact",
    async search(t) {
      return t.business_name ? [{ source_id: "stub-phone", business_name: "ACME LLC", phone: "3135550100",
        confidence: "high", legal_status: "public_official_api" }] : [];
    },
  },
  "stub-empty": { id: "stub-empty", type: "public-contact", async search() { return []; } },
  "not-contact": { id: "not-contact", type: "listings", async search() { return [{ phone: "9999999999" }]; } },
  ...over,
});

test("fans across public-contact connectors and returns ranked phone candidates", async () => {
  const r = await findContact(reg(), { business_name: "ACME", address: "1 Main St, Detroit, MI" });
  assert.equal(r.freePhoneCount, 1);
  assert.equal(r.candidates[0].phone, "3135550100");
  assert.equal(r.candidates[0].source_id, "stub-phone");
  assert.equal(r.nextStep, "free_public_phone_found");
});

test("ignores non-contact connectors (does not pull the listings phone)", async () => {
  const r = await findContact(reg(), { business_name: "ACME" });
  assert.ok(r.routesTried.includes("stub-phone"));
  assert.ok(!r.routesTried.includes("not-contact"));
  assert.ok(!r.candidates.some((c) => c.phone === "9999999999"));
});

test("every candidate is compliance-gated (never auto-callable)", async () => {
  const r = await findContact(reg(), { business_name: "ACME" });
  for (const c of r.candidates) {
    assert.equal(c.outreach_allowed, false);
    assert.equal(c.compliance_status, "unchecked");
  }
});

test("no free phone + no key → escalates to research agent / add key", async () => {
  const r = await findContact({ "stub-empty": reg()["stub-empty"] }, { business_name: "NOBODY" });
  assert.equal(r.freePhoneCount, 0);
  assert.equal(r.nextStep, "no_free_contact");
  assert.equal(r.escalation.route, "research_agent_or_add_key");
});

test("no free phone + batchdata key → escalates to paid skiptrace", async () => {
  const r = await findContact({ "stub-empty": reg()["stub-empty"] }, { business_name: "NOBODY" }, { batchdataKey: true });
  assert.equal(r.nextStep, "paid_skiptrace_available");
  assert.equal(r.escalation.route, "batchdata-skiptrace");
});

test("a failing connector never breaks the route", async () => {
  const r = await findContact({ boom: { id: "boom", type: "public-contact", async search() { throw new Error("x"); } } },
    { business_name: "ACME" });
  assert.deepEqual(r.candidates, []);
  assert.equal(r.routesTried[0], "boom");
});

test("dedups identical phones across sources, keeps highest score", async () => {
  const two = reg({ "stub-phone2": { id: "stub-phone2", type: "public-contact",
    async search() { return [{ source_id: "stub-phone2", phone: "3135550100", confidence: "low" }]; } } });
  const r = await findContact(two, { business_name: "ACME" });
  assert.equal(r.candidates.filter((c) => c.phone === "3135550100").length, 1);
  assert.equal(r.candidates[0].source_id, "stub-phone"); // high confidence wins
});
