// contact_route_engine.test.js -- the ContactRouteEngine resolver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContactRoute } from "./contact_route_engine.js";

test("from a property node (address+owner), plans a legal path to phone but no outreach yet", () => {
  const r = resolveContactRoute({
    node: { id: "property:6", kind: "property", fields: { address: "1429 N Springfield Ave", owner_name: "MAPLE COURT LLC" } },
    goal: "phone",
    hasKeys: {},
  });
  assert.ok(r.best_path, "should find a legal path to phone");
  assert.equal(r.outreach_allowed, false);          // no candidate yet
  assert.match(r.blocked_reason, /execute it to obtain the contact/);
  assert.ok(r.entity.known_fields.includes("owner_name"));
});

test("a found contact stays blocked until DNC/consent clears", () => {
  const r = resolveContactRoute({
    node: { id: "p1", kind: "property", fields: { address: "1 Main St", owner_name: "Jane" } },
    goal: "phone",
    candidate: { phone: "3135550100", dnc_status: "" }, // unknown DNC
    channels: ["call"],
  });
  assert.equal(r.contact_candidate.outreach_allowed, false);
  assert.equal(r.outreach_allowed, false);
  assert.match(r.blocked_reason, /not compliance-cleared/);
});

test("a DNC-clear contact flips outreach_allowed for the call channel", () => {
  const r = resolveContactRoute({
    node: { id: "p1", kind: "property", fields: { address: "1 Main St", owner_name: "Jane" } },
    goal: "phone",
    candidate: { phone: "3135550100", dnc_status: "clear" },
    channels: ["call"],
  });
  assert.equal(r.outreach_allowed, true);
  assert.equal(r.blocked_reason, null);
  assert.equal(r.contact_candidate.outreach_allowed, false); // the stored candidate stays gated by record
});

test("no usable fields -> no legal path to goal", () => {
  const r = resolveContactRoute({ node: { id: "x", kind: "property", fields: {} }, goal: "phone" });
  assert.equal(r.best_path, null);
  assert.equal(r.blocked_reason, "no legal path to goal");
});
