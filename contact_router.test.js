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

// --- DEEPSEEK: expanded compliance-gate tests (Loop Step 5) ---

test("compliance_note is set on every candidate (DNC/consent warning)", async () => {
  const r = await findContact(reg(), { business_name: "ACME" });
  for (const c of r.candidates) {
    assert.ok(c.compliance_note && c.compliance_note.length > 0, "compliance_note must be non-empty");
    assert.match(c.compliance_note, /DNC|consent/i, "compliance_note must mention DNC/consent");
  }
});

test("source attempting outreach_allowed:true is overridden to false (gate is authoritative)", async () => {
  const lying = reg({
    "lying-src": {
      id: "lying-src", type: "public-contact",
      async search() {
        return [{
          source_id: "lying-src", business_name: "ACME",
          phone: "3135550199", confidence: "high",
          legal_status: "public_official_api",
          outreach_allowed: true, // source LIES — must be overridden
          compliance_status: "verified",
        }];
      },
    },
  });
  const r = await findContact(lying, { business_name: "ACME" });
  const cand = r.candidates.find((c) => c.phone === "3135550199");
  assert.ok(cand, "candidate must exist");
  assert.equal(cand.outreach_allowed, false, "router MUST force outreach_allowed=false regardless of source");
  assert.equal(cand.compliance_status, "unchecked", "router MUST force compliance_status=unchecked regardless of source");
});

test("relation defaults to business_or_operator (honest: not necessarily the deed owner)", async () => {
  const r = await findContact(reg(), { business_name: "ACME" });
  for (const c of r.candidates) {
    assert.equal(c.relation, "business_or_operator",
      "public-contact hits must NOT be claimed as the deed owner");
  }
});

test("relation becomes owner only when is_confirmed_owner:true", async () => {
  const ownerReg = reg({
    "owner-src": {
      id: "owner-src", type: "public-contact",
      async search() {
        return [{
          source_id: "owner-src", business_name: "ACME",
          phone: "3135550288", confidence: "high",
          legal_status: "public_official_api",
          is_confirmed_owner: true,
        }];
      },
    },
  });
  const r = await findContact(ownerReg, { business_name: "ACME" });
  const cand = r.candidates.find((c) => c.phone === "3135550288");
  assert.ok(cand);
  assert.equal(cand.relation, "owner", "only confirmed-owner sources may claim relation=owner");
});

test("email-only candidates are also compliance-gated", async () => {
  const emailReg = reg({
    "email-src": {
      id: "email-src", type: "public-contact",
      async search() {
        return [{
          source_id: "email-src", business_name: "ACME",
          email: "acme@example.com", phone: null,
          confidence: "medium", legal_status: "public_official_api",
        }];
      },
    },
  });
  const r = await findContact(emailReg, { business_name: "ACME" });
  assert.ok(r.freeEmailCount >= 1, "email candidate must be counted");
  for (const c of r.candidates) {
    assert.equal(c.outreach_allowed, false);
    assert.equal(c.compliance_status, "unchecked");
    assert.ok(c.compliance_note);
  }
});

test("multiple candidates from multiple sources all stay compliance-gated", async () => {
  const multi = reg({
    "src-a": { id: "src-a", type: "public-contact", async search() {
      return [{ source_id: "src-a", phone: "3135550301", confidence: "high", legal_status: "public_official_api" }];
    } },
    "src-b": { id: "src-b", type: "public-contact", async search() {
      return [{ source_id: "src-b", phone: "3135550302", confidence: "medium", legal_status: "public_official_api" }];
    } },
    "src-c": { id: "src-c", type: "public-contact", async search() {
      return [{ source_id: "src-c", email: "x@example.com", confidence: "low", legal_status: "public_official_api" }];
    } },
  });
  const r = await findContact(multi, { business_name: "ACME" });
  assert.ok(r.candidates.length >= 2, "should collect from multiple sources");
  for (const c of r.candidates) {
    assert.equal(c.outreach_allowed, false);
    assert.equal(c.compliance_status, "unchecked");
    assert.ok(c.compliance_note);
    assert.ok(c.relation === "business_or_operator" || c.relation === "owner");
  }
});
