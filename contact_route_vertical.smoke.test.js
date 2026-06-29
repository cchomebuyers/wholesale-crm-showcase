// contact_route_vertical.smoke.test.js -- end-to-end regression guard for the ContactRouteEngine.
// Exercises the whole legal-contact vertical as ONE flow so a concurrent change to any link is
// caught: field_edges -> route_planner -> compliance_gate -> consent -> contact_route_engine.
// Pure: no routes, no DB, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeEdges, extractFields } from "./field_edges.js";
import { planRoutes } from "./route_planner.js";
import { complianceCheck } from "./compliance_gate.js";
import { makeConsentRecord, consentToContactCandidate } from "./consent.js";
import { resolveContactRoute } from "./contact_route_engine.js";

const propertyNode = {
  id: "property:39", kind: "property", source: "cook-il-parcel-addresses",
  fields: { address: "11306 S DRAKE AVE", owner_name: "TERRENCE SHANKLIN", mailing_address: "3501 OLYMPUS BLVD" },
};

test("VERTICAL: a property node exposes joinable fields and proposes candidate edges", () => {
  const fields = extractFields(propertyNode).map((f) => f.field);
  assert.ok(fields.includes("address") && fields.includes("owner_name"));
  const edges = proposeEdges(propertyNode);
  assert.ok(edges.length > 0 && edges.every((e) => e.status === "candidate")); // never auto-confirmed
});

test("VERTICAL: from address+owner the planner reaches a phone via a legal (non-RED) route", () => {
  const plan = planRoutes({ goal: "phone", known: ["address", "owner_name"], hasKeys: {} });
  assert.ok(plan.best_path, "a legal path to phone exists");
  assert.notEqual(plan.best_path.class, "RED");
  assert.equal(plan.best_path.outreach_allowed, false); // planning never authorizes outreach
});

test("VERTICAL: resolveContactRoute plans but does NOT authorize outreach without a contact", () => {
  const r = resolveContactRoute({ node: propertyNode, goal: "phone", hasKeys: {} });
  assert.ok(r.best_path);
  assert.equal(r.outreach_allowed, false);
  assert.match(r.blocked_reason, /execute it to obtain the contact/);
});

test("VERTICAL: a skip-traced number stays BLOCKED until DNC clears (no consent path)", () => {
  const r = resolveContactRoute({
    node: propertyNode, goal: "phone",
    candidate: { phone: "3135550100", dnc_status: "" }, channels: ["call"],
  });
  assert.equal(r.outreach_allowed, false);
});

test("VERTICAL: first-party consent is the ONLY no-spend path that flips outreach_allowed:true", () => {
  const consent = makeConsentRecord({ name: "Terrence", phone: "3135550100", consent: true, channels: ["call", "sms"] });
  assert.equal(consent.valid, true);
  const candidate = consentToContactCandidate(consent);
  const r = resolveContactRoute({ node: propertyNode, goal: "phone", candidate, channels: ["call"] });
  assert.equal(r.outreach_allowed, true);              // consent = lawful basis, no paid skiptrace
  // and a channel the seller did NOT consent to stays blocked
  const email = complianceCheck(candidate, { channels: ["email"] });
  assert.equal(email.outreach_allowed, false);
});

test("VERTICAL: the gate is authoritative — a lying source candidate is forced back to blocked", () => {
  const r = resolveContactRoute({
    node: propertyNode, goal: "phone",
    candidate: { phone: "3135550100", outreach_allowed: true, dnc_status: "" }, channels: ["call"],
  });
  assert.equal(r.contact_candidate.outreach_allowed, false); // never trust the source claim
});
