import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuyerInterestQueue, buildBuyerInterestRequest } from "./buyer_interest.js";

test("buildBuyerInterestRequest records buyer interest without seller contact", () => {
  const out = buildBuyerInterestRequest({
    deal: {
      property_id: 39,
      title: "123 Main St",
      market: "Chicago, IL",
      economics: {
        projected_spread: 15000,
        buyer_acceptance: { score: 3.4 },
      },
      proof: {
        proof_url: "/api/proof-stack/39",
        kg_evidence_url: "/api/kg/properties/39/evidence",
      },
    },
    buyer: { name: "Cash Buyer", email: "buyer@example.com", buy_box: "Cook SFR under 150k" },
    message: "Send me the proof package.",
    createdAt: "2026-06-29T10:00:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.request.property_id, 39);
  assert.equal(out.request.buyer.email, "buyer@example.com");
  assert.equal(out.request.deal.proof_url, "/api/proof-stack/39");
  assert.equal(out.request.marketplace_safety.seller_contact_redacted, true);
  assert.equal(out.request.marketplace_safety.seller_contact_shared, false);
  assert.equal(Object.hasOwn(out.request, "seller"), false);
});

test("buildBuyerInterestRequest requires a buyer contact signal", () => {
  const out = buildBuyerInterestRequest({ deal: { property_id: 39 }, buyer: {} });
  assert.equal(out.ok, false);
  assert.match(out.error, /buyer name/);
});

test("buildBuyerInterestQueue sorts new requests first and keeps redaction citations", () => {
  const out = buildBuyerInterestQueue({
    requests: [
      { id: 1, property_id: 39, status: "contacted", created_at: "2026-06-29T09:00:00.000Z" },
      { id: 2, property_id: 60, status: "new_interest", created_at: "2026-06-29T08:00:00.000Z" },
    ],
  });

  assert.equal(out.summary.total_interest, 2);
  assert.equal(out.items[0].id, 2);
  assert.equal(out.items[0].marketplace_safety.seller_contact_shared, false);
  assert.equal(out.citations[0].module, "investor_marketplace.js#buildInvestorMarketplace");
});
