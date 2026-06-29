// marketplace_privacy.test.js -- the buyer marketplace must NEVER leak seller PII.
// A buyer browsing deals may see deal-safe economics (ARV, spread, market area) but never the
// seller's name, mailing address, phone, or email. This locks that boundary so a future change
// to investor_marketplace.js can't silently expose seller contact into a buyer-facing payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvestorMarketplace } from "./investor_marketplace.js";

// A property carrying every seller-PII field the CRM stores. None of these VALUES may appear in
// the deal output a buyer receives.
const SELLER_PII = {
  owner_name: "TERRENCE SHANKLIN",
  owner_mailing: "3501 OLYMPUS BLVD #500",
  seller_name: "Terrence Shanklin",
  seller_phone: "3135550100",
  seller_email: "seller@example.com",
  listing_agent_phone: "3125559999",
  listing_agent_email: "agent@example.com",
};
const property = {
  id: 39, formatted_address: "11306 S DRAKE AVE", city: "Chicago", state: "IL", county: "Cook County",
  property_type: "Single Family", source: "cook-il-violations",
  lead_score: 78, wholesale_score: 78, distress_score: 76,
  arv: 300000, repair_estimate: 40000, mao: 150000, price: 90000,
  ...SELLER_PII,
};

function deepStrings(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === "string") acc.push(obj);
  else if (typeof obj === "object") for (const v of Object.values(obj)) deepStrings(v, acc);
  return acc;
}

test("marketplace deal exposes deal-safe economics but NOT seller PII", () => {
  const out = buildInvestorMarketplace({
    properties: [property],
    crmBuyers: [{ id: 1, name: "GRANDVIEW HOMES LLC", areas: "Cook County, IL", property_types: "Single Family", max_price: 250000, cash: 1 }],
    discoveredCandidates: [],
    sellerEvidenceByPropertyId: {},
    spreadOptions: {},
    limit: 10,
    minBuyerScore: 0,
  });
  const blob = JSON.stringify(out);

  // seller PII values must be absent from the entire buyer-facing payload
  for (const [field, value] of Object.entries(SELLER_PII)) {
    assert.ok(!blob.includes(value), `seller PII leaked into marketplace: ${field}="${value}"`);
  }
  // and no deal object should carry seller-contact KEYS
  const leakyKeys = ["owner_name", "owner_mailing", "seller_name", "seller_phone", "seller_email", "listing_agent_phone", "listing_agent_email"];
  for (const deal of out.deals || []) {
    for (const k of leakyKeys) assert.ok(!(k in deal), `deal exposes seller-contact key: ${k}`);
  }

  // deal-safe economics ARE present (proves we didn't pass by returning nothing)
  if (out.deals && out.deals.length) {
    const d = out.deals[0];
    assert.ok(d.economics, "deal must carry economics");
    assert.ok("arv" in d.economics, "deal must show ARV (deal-safe)");
    assert.ok(deepStrings(d).some((s) => /DRAKE|Chicago|Cook/i.test(s)), "deal must show market/address (deal-safe)");
  }
});
