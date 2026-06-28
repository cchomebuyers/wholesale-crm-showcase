import { test } from "node:test";
import assert from "node:assert/strict";
import { BUYER_DISCOVERY_SOURCE_FAMILIES, normalizeBuyerCandidate, rankBuyerDemand } from "./buyer_discovery.js";

test("normalizes future buyer candidates into buyer-compatible buy boxes", () => {
  const c = normalizeBuyerCandidate({
    business_name: "Flip Fund LLC",
    phone: "3135550101",
    zip: "48235",
    property_type: "Single Family",
    max_price_estimate: 120000,
    source_id: "recorded-cash-buyers",
    purchase_count: 4,
  });
  assert.equal(c.name, "Flip Fund LLC");
  assert.equal(c.areas, "48235");
  assert.equal(c.max_price, 120000);
  assert.equal(c.evidence.purchase_count, 4);
});

test("buyer demand ranks CRM buyers and discovered candidates together", () => {
  const out = rankBuyerDemand({
    property: { city: "Detroit", zip: "48235", property_type: "Single Family", mao: 80000 },
    crmBuyers: [{ id: 1, name: "Manual Buyer", areas: "48235", property_types: "SFR", max_price: 90000, phone: "313", cash: 1 }],
    discoveredCandidates: [{ id: 2, name: "Discovered Buyer", areas: "Detroit", property_types: "Single Family", max_price: 100000, email: "b@example.com", cash: 1 }],
  });
  assert.equal(out.all.length, 2);
  assert.ok(out.all[0].score >= 70);
  assert.equal(out.gaps.length, 0);
});

test("buyer discovery source families are data, not hardcoded buyer count", () => {
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.length >= 5);
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.every((x) => x.id && x.inputs.length && x.outputs.length));
});
