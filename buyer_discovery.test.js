import { test } from "node:test";
import assert from "node:assert/strict";
import { BUYER_DISCOVERY_SOURCE_FAMILIES, normalizeBuyerCandidate, rankBuyerDemand, isRealBuyer, buyerConfidence, buyerMarketDemand, qualifiesForPromotion } from "./buyer_discovery.js";

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

test("buyerMarketDemand counts area-matching cash buyers (contact-independent)", () => {
  const buyers = [
    { name: "GRANDVIEW HOMES LLC", areas: "Cook County, IL", max_price: 425000 },
    { name: "SYLVA LLC", areas: "Cook County, IL", max_price: 126000 },
    { name: "PHX FLIP LLC", areas: "Maricopa County, AZ", max_price: 300000 },
  ];
  const d = buyerMarketDemand({ county: "Cook County", state: "IL" }, buyers);
  assert.equal(d.demand_count, 2);            // two Cook buyers, AZ excluded
  assert.equal(d.has_demand, true);
  assert.equal(d.top_buyer.name, "GRANDVIEW HOMES LLC"); // highest max_price
});

test("buyerMarketDemand applies price filter only when property value is known", () => {
  const buyers = [{ name: "SMALL LLC", areas: "Cook County, IL", max_price: 80000 }];
  assert.equal(buyerMarketDemand({ county: "Cook County", state: "IL" }, buyers).demand_count, 1); // value unknown -> kept
  assert.equal(buyerMarketDemand({ county: "Cook County", state: "IL", arv: 200000 }, buyers).demand_count, 0); // 200k > 80k*1.15
});

test("buyer discovery source families are data, not hardcoded buyer count", () => {
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.length >= 5);
  assert.ok(BUYER_DISCOVERY_SOURCE_FAMILIES.every((x) => x.id && x.inputs.length && x.outputs.length));
});

// ---- bulk-promotion quality gate ----
test("qualifiesForPromotion: high-confidence cash buyer with area passes", () => {
  const q = qualifiesForPromotion({ name: "GRANDVIEW HOMES 1, LLC", cash: 1, confidence: "high", areas: "Cook County, IL" });
  assert.equal(q.ok, true);
});
test("gate rejects: low confidence, no cash, no area, already promoted, non-buyers", () => {
  const base = { name: "REAL BUYER LLC", cash: 1, confidence: "high", areas: "Cook" };
  assert.equal(qualifiesForPromotion({ ...base, confidence: "low" }).ok, false);
  assert.equal(qualifiesForPromotion({ ...base, cash: 0 }).ok, false);
  assert.equal(qualifiesForPromotion({ ...base, areas: "" }).ok, false);
  assert.equal(qualifiesForPromotion({ ...base, imported_buyer_id: 5 }).ok, false);
  assert.equal(qualifiesForPromotion({ ...base, name: "CHICAGO TITLE LAND TRUST" }).ok, false);
});
test("gate loosens with minConfidence=medium / requireCash=false", () => {
  assert.equal(qualifiesForPromotion({ name: "X LLC", cash: 1, confidence: "medium", areas: "Cook" }, { minConfidence: "medium" }).ok, true);
  assert.equal(qualifiesForPromotion({ name: "X LLC", cash: 0, confidence: "high", areas: "Cook" }, { requireCash: false }).ok, true);
});
