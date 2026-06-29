// proof_stack.test.js -- the per-property evidence ledger (NORTH_STAR_VISION #5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProofStack } from "./proof_stack.js";

// A fully-proven distressed deal: real signal, absentee entity owner, ARV, a
// matching buyer, a seller anchor, and a spread that holds.
const fullDeal = {
  id: 39,
  formatted_address: "123 Distress Ave",
  city: "Chicago", state: "IL", zip: "60601", county: "Cook",
  source: "cook-il-violations", source_id: "v-39",
  lead_score: 80, distress_score: 78, motivation_score: 70,
  owner_name: "Tired Landlord LLC", owner_mailing: "999 Elsewhere Rd, Naperville IL",
  owner_source: "cook-assessor",
  arv: 200000, repair_estimate: 30000, square_footage: 1400,
  asking_price: 95000,
};

test("full-evidence property assembles all seven pillars with high completeness", () => {
  const ps = buildProofStack(fullDeal, {
    buyerMatches: [{ name: "Cash Buyer A", max_price: 150000, source: "cook-recorded-sales" }],
    sellerEvidence: { price: 95000, source: "asking_price", confidence: "medium" },
  });
  assert.equal(ps.property_id, 39);
  assert.equal(ps.identity.city, "Chicago");
  // pillars present
  assert.equal(ps.evidence.signal.present, true);
  assert.equal(ps.evidence.signal.from_source, true);
  assert.equal(ps.evidence.owner.present, true);
  assert.equal(ps.evidence.owner.absentee, true);
  assert.equal(ps.evidence.owner.entity_owner, true);
  assert.equal(ps.evidence.valuation.present, true);
  assert.ok(ps.evidence.valuation.mao > 0, "MAO derived from ARV");
  assert.equal(ps.evidence.buyer_demand.present, true);
  assert.equal(ps.evidence.buyer_demand.count, 1);
  assert.equal(ps.evidence.seller_price.present, true);
  assert.equal(ps.evidence.seller_price.best.price, 95000);
  assert.equal(ps.evidence.spread.present, true);
  assert.ok(["works", "thin", "fails"].includes(ps.evidence.spread.status));
  // completeness + citations + decision
  assert.equal(ps.completeness.score, 1);
  assert.deepEqual(ps.completeness.missing, []);
  assert.equal(ps.citations.length, 7);
  assert.ok(ps.decision && ps.decision.tier);
});

test("sparse parcel-only property reports the exact missing pillars", () => {
  const ps = buildProofStack({
    id: 7, source: "sandiego-ca-parcels", address: "1 Empty Lot", lead_score: 40, distress_score: 8,
  });
  assert.equal(ps.evidence.signal.parcel_only, true);
  assert.equal(ps.evidence.owner.present, false);
  assert.equal(ps.evidence.valuation.present, false);
  assert.equal(ps.evidence.buyer_demand.present, false);
  assert.equal(ps.completeness.score < 1, true);
  assert.ok(ps.completeness.missing.includes("owner"));
  assert.ok(ps.completeness.missing.includes("valuation"));
  assert.equal(ps.completeness.deal_ready, false);
});

test("institutional owner is surfaced and never marked deal-ready", () => {
  const ps = buildProofStack({
    id: 8, source: "cook-il-violations", lead_score: 90, distress_score: 80,
    owner_name: "City of Chicago", arv: 150000, repair_estimate: 10000,
  }, {
    buyerMatches: [{ name: "B", max_price: 130000 }],
    sellerEvidence: { price: 60000, source: "contract_price", confidence: "high" },
  });
  assert.equal(ps.evidence.owner.institutional_owner, true);
  assert.equal(ps.decision.tier, "hold");
  assert.equal(ps.completeness.deal_ready, false);
});

test("buyer-acceptance economics are carried into the proof stack spread pillar", () => {
  const ps = buildProofStack({
    id: 9, source: "cook-il-violations", lead_score: 85, distress_score: 75,
    owner_name: "Owner LLC", owner_mailing: "far away",
    arv: 200000, repair_estimate: 20000, contract_price: 70000,
  }, {
    buyerMatches: [{ name: "Buyer", max_price: 140000 }],
    sellerEvidence: { price: 70000, source: "contract_price", confidence: "high" },
  });
  assert.ok(ps.evidence.spread.buyer_acceptance, "buyer_acceptance object present");
  assert.ok("rating" in ps.evidence.spread.buyer_acceptance);
});

test("precomputed spread/queue are honored (no recompute) and engine failure degrades gracefully", () => {
  const fakeSpread = { status: "works", projectedSpread: 12000, targetFee: 10000, inputs: {}, reasons: ["pre"], nextNeeded: [] };
  const fakeQueue = { tier: "call_now", priority_score: 99, next_action: "dial", spend_allowed: false, missing: [], reasons: ["pre"] };
  const ps = buildProofStack({ id: 10, source: "x" }, { spread: fakeSpread, queue: fakeQueue });
  assert.equal(ps.evidence.spread.projected_spread, 12000);
  assert.equal(ps.decision.tier, "call_now");
  assert.equal(ps.decision.priority_score, 99);
});
