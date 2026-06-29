import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSellerPromotionWorkflow, normalizeAddressKey } from "./seller_promotion.js";

test("normalizeAddressKey canonicalizes common street suffixes", () => {
  assert.equal(normalizeAddressKey(" 10 Main Street, Detroit MI "), "10 main st detroit mi");
  assert.equal(normalizeAddressKey("10 MAIN ST Detroit MI"), "10 main st detroit mi");
});

test("buildSellerPromotionWorkflow links consent lead to matching proof stack", () => {
  const out = buildSellerPromotionWorkflow({
    consentRecords: [{
      id: 7,
      created_at: "2026-06-29T10:00:00.000Z",
      name: "Jane Seller",
      phone: "3135550100",
      address: "10 Main Street",
      channels: JSON.stringify(["call", "sms"]),
      legal_basis: "first_party_express_consent",
    }],
    properties: [{
      id: 39,
      address: "10 Main St",
      city: "Detroit",
      state: "MI",
      source: "first_party_match",
      wholesale_score: 88,
    }],
  });

  assert.equal(out.summary.matched_properties, 1);
  assert.equal(out.summary.ready_for_proof, 1);
  assert.equal(out.items[0].status, "matched_property");
  assert.equal(out.items[0].property.id, 39);
  assert.equal(out.items[0].workflow.proof_url, "/api/proof-stack/39");
  assert.equal(out.items[0].seller.outreach_allowed, true);
  assert.equal(out.marketplace_safety.seller_contact_redacted_from_buyer_marketplace, true);
});

test("buildSellerPromotionWorkflow flags consent leads needing address confirmation", () => {
  const out = buildSellerPromotionWorkflow({
    consentRecords: [{ id: 8, name: "No Address", phone: "3135550100", channels: "call" }],
    properties: [],
  });

  assert.equal(out.summary.needs_address, 1);
  assert.equal(out.items[0].status, "needs_address");
  assert.equal(out.items[0].workflow.queue_target, "seller_intake");
  assert.equal(out.items[0].workflow.proof_url, null);
});
