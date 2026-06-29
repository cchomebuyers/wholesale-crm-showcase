import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvestorMarketplace } from "./investor_marketplace.js";

test("buildInvestorMarketplace returns buyer-matched deals without seller contact", () => {
  const out = buildInvestorMarketplace({
    properties: [{
      id: 39,
      formatted_address: "123 Main St",
      city: "Chicago",
      state: "IL",
      zip: "60601",
      county: "Cook",
      property_type: "single family",
      arv: 160000,
      repair_estimate: 20000,
      mao: 82000,
      wholesale_score: 91,
      owner_name: "Owner LLC",
      source: "cook-il-violations",
    }],
    crmBuyers: [{
      id: 1,
      name: "Cook Cash Buyer",
      phone: "3125550100",
      email: "buyer@example.com",
      areas: "Cook",
      property_types: "single family",
      max_price: 130000,
      cash: 1,
    }],
    sellerEvidenceByPropertyId: {
      39: { price: 95000, confidence: "anchor", source: "seller_note" },
    },
    spreadOptions: { minFee: 10000, buyerPct: 70, negotiationDiscountPct: 10 },
  });

  assert.equal(out.summary.scanned_properties, 1);
  assert.equal(out.summary.matched_deals, 1);
  assert.equal(out.deals[0].property_id, 39);
  assert.equal(out.deals[0].buyer_demand.top_buyer.name, "Cook Cash Buyer");
  assert.equal(out.deals[0].compliance.seller_contact_redacted, true);
  assert.equal(out.deals[0].compliance.outreach_allowed, false);
  assert.equal(out.deals[0].proof.proof_url, "/api/proof-stack/39");
  assert.equal(out.citations[0].module, "buyer_discovery.js#rankBuyerDemand");
});

test("buildInvestorMarketplace filters weak buyer matches by default", () => {
  const out = buildInvestorMarketplace({
    properties: [{ id: 1, city: "Detroit", state: "MI", property_type: "single family" }],
    crmBuyers: [{ id: 2, name: "Chicago Buyer", areas: "Chicago", property_types: "single family", cash: 1 }],
    minBuyerScore: 70,
  });

  assert.equal(out.summary.matched_deals, 0);
  assert.deepEqual(out.deals, []);
});
