import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBuyersForProperty, scoreBuyerForProperty } from "./buyer_matching.js";

const property = {
  city: "Detroit",
  state: "MI",
  zip: "48235",
  county: "Wayne",
  property_type: "Single Family",
  mao: 80000,
};

test("scoreBuyerForProperty rewards area, type, price, contact, and cash fit", () => {
  const m = scoreBuyerForProperty({
    id: 1,
    name: "Detroit Cash Buyer",
    phone: "3135550100",
    email: "buyer@example.com",
    areas: "Detroit;48235",
    property_types: "SFR;duplex",
    max_price: 120000,
    cash: 1,
  }, property);

  assert.equal(m.fit, "strong");
  assert.ok(m.score >= 70);
  assert.ok(m.reasons.some((r) => r.includes("matches area")));
});

test("rankBuyersForProperty orders strongest buyers first", () => {
  const ranked = rankBuyersForProperty([
    { id: 1, name: "Weak", areas: "Chicago", property_types: "Land", max_price: 30000, cash: 0 },
    { id: 2, name: "Strong", phone: "3135550100", areas: "Detroit", property_types: "Single Family", max_price: 100000, cash: 1 },
  ], property);

  assert.equal(ranked[0].buyer_id, 2);
  assert.equal(ranked[0].fit, "strong");
});
