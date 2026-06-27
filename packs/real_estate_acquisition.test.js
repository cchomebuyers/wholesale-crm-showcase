// packs/real_estate_acquisition.test.js — the domain pack runs the real pipeline through the kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRealEstateEngine } from "./real_estate_acquisition.js";

// stub registry: one public-contact connector returning a phone; stub geocode (no network).
const stubRegistry = {
  "stub-phone": {
    id: "stub-phone", type: "public-contact",
    async search(t) { return t.business_name ? [{ source_id: "stub-phone", business_name: "ACME LLC", phone: "3135550100", confidence: "high", legal_status: "public_official_api" }] : []; },
  },
};
const stubGeocode = async (addr) => ({ matched: true, standardized: String(addr).toUpperCase(), lat: 42.33, lon: -83.04 });

test("pack registers the address_to_contact route + its 3 capabilities", () => {
  const e = buildRealEstateEngine({ registry: stubRegistry, geocode: stubGeocode });
  assert.ok(e.routes.has("address_to_contact"));
  for (const c of ["geocode_address", "find_contact", "compliance_gate"]) assert.ok(e.capabilities.has(c));
});

test("runs end-to-end: geocode → find_contact → compliance gate", async () => {
  const e = buildRealEstateEngine({ registry: stubRegistry, geocode: stubGeocode });
  const r = await e.runRoute("address_to_contact", { address: "1 main st, detroit", business_name: "ACME" });
  assert.equal(r.vars.geo.matched, true);
  assert.equal(r.vars.geo.lat, 42.33);
  assert.equal(r.result.candidates[0].phone, "3135550100");
  assert.equal(r.result.gated, true);
  assert.equal(r.result.candidates[0].outreach_allowed, false); // never auto-callable
  assert.equal(r.evidence.length, 3);
});

test("planner ranks the route as runnable for goal find_contact", () => {
  const e = buildRealEstateEngine({ registry: stubRegistry, geocode: stubGeocode });
  const ranked = e.plan("find_contact");
  const route = ranked.find((x) => x.route === "address_to_contact");
  assert.ok(route && route.runnable);
});

test("no batchdata key → contact finder escalation surfaces (no free phone case)", async () => {
  const e = buildRealEstateEngine({ registry: { empty: { id: "empty", type: "public-contact", async search() { return []; } } }, geocode: stubGeocode });
  const r = await e.runRoute("address_to_contact", { address: "x", business_name: "NOBODY" });
  assert.equal(r.result.nextStep, "no_free_contact");
});
