// route_planner.test.js -- legal shortest-path planning for the ContactRouteEngine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoutes, scoreRoute, ROUTE_FAMILIES } from "./route_planner.js";

test("from just an address, owner is reachable via the assessor route (free, GREEN)", () => {
  const r = planRoutes({ goal: "owner_name", known: ["address"] });
  assert.equal(r.best_path.route, "address_to_parcel_to_owner");
  assert.equal(r.best_path.class, "GREEN");
  assert.equal(r.best_path.available, true);
  assert.equal(r.best_path.outreach_allowed, false);
});

test("phone from address+owner: skiptrace needs its key; free business-license route wins when no key", () => {
  const noKey = planRoutes({ goal: "phone", known: ["address", "owner_name"], hasKeys: {} });
  // skiptrace is blocked (no key), business_license / permit are free & available
  assert.ok(noKey.best_path, "should have a free path to phone");
  assert.notEqual(noKey.best_path.route, "owner_address_skiptrace");
  const skip = noKey.all.find((p) => p.route === "owner_address_skiptrace");
  assert.equal(skip.available, false);
  assert.match(skip.blocked_reason, /batchdata_api_key/);
});

test("with a skiptrace key, skiptrace becomes available", () => {
  const withKey = planRoutes({ goal: "phone", known: ["address", "owner_name"], hasKeys: { batchdata_api_key: true } });
  const skip = withKey.all.find((p) => p.route === "owner_address_skiptrace");
  assert.equal(skip.available, true);
  assert.equal(skip.outreach_allowed, false); // still gated until compliance
});

test("first-party consent is the cheapest path to phone (consent bonus)", () => {
  const r = planRoutes({ goal: "phone", known: ["consent", "address", "owner_name"], hasKeys: { batchdata_api_key: true } });
  assert.equal(r.best_path.route, "first_party_consent");
});

test("a goal needing inputs we cannot reach yields no available path", () => {
  const r = planRoutes({ goal: "registered_agent", known: [] }); // no address, no owner -> nothing
  assert.equal(r.best_path, null);
  assert.ok(r.all.every((p) => !p.available));
});

test("2-hop chaining: address makes owner reachable, which makes skiptrace's inputs reachable", () => {
  const r = planRoutes({ goal: "phone", known: ["address"], hasKeys: { batchdata_api_key: true } });
  assert.ok(r.reachable_fields.includes("owner_name"));
  const skip = r.all.find((p) => p.route === "owner_address_skiptrace");
  assert.equal(skip.needs_precursor, true); // owner_name not directly known, but reachable
});

test("RED sources are never planned", () => {
  // no route family uses a RED source by default; assert the policy guard holds via a synthetic goal
  const r = planRoutes({ goal: "phone", known: ["address", "owner_name"] });
  assert.ok(r.all.every((p) => p.class !== "RED"));
});

test("scoreRoute rewards confidence and punishes legal risk", () => {
  const hi = scoreRoute({ id: "x", base_confidence: 0.9 }, { cost: 0, legal_risk: 0.05, latency: 1, manual_effort: 0 }, { knownSet: new Set() });
  const risky = scoreRoute({ id: "y", base_confidence: 0.9 }, { cost: 0, legal_risk: 0.9, latency: 1, manual_effort: 0 }, { knownSet: new Set() });
  assert.ok(hi < risky, "higher legal risk costs more");
});

test("ROUTE_FAMILIES are well-formed", () => {
  assert.ok(ROUTE_FAMILIES.length >= 5);
  for (const r of ROUTE_FAMILIES) assert.ok(r.id && r.requires && r.produces.length && r.source);
});
