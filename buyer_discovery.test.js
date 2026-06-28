import { test } from "node:test";
import assert from "node:assert/strict";
import { BUYER_DISCOVERY_SOURCE_FAMILIES, normalizeBuyerCandidate, rankBuyerDemand, isRealBuyer, buyerConfidence } from "./buyer_discovery.js";

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

test("isRealBuyer rejects title/land-trust/agency vehicles, keeps real investors", () => {
  assert.equal(isRealBuyer("GRANDVIEW HOMES 1, LLC"), true);
  assert.equal(isRealBuyer("KENDALL PARTNERS LTD"), true);
  assert.equal(isRealBuyer("CHICAGO TITLE LAND TRUST COMPANY"), false);
  assert.equal(isRealBuyer("TULE RIVER HOMEBUYER EARNED EQUITY AGENCY"), false);
  assert.equal(isRealBuyer("CITY OF CHICAGO"), false);
});

test("buyerConfidence scales with purchase volume", () => {
  assert.equal(buyerConfidence(118), "high");
  assert.equal(buyerConfidence(12), "medium");
  assert.equal(buyerConfidence(5), "low");
});

test("buyer discovery source families are data, not hardcoded buyer count", () => {
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.length >= 5);
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.every((x) => x.id && x.inputs.length && x.outputs.length));
});
