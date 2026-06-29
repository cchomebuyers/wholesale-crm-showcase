// proof_stack.test.js -- the per-property evidence ledger (NORTH_STAR_VISION #5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProofStack, buyerSafeProofStack } from "./proof_stack.js";

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

// ---- buyer-safe marketplace view: the internal-only seller boundary ----

const internalProof = buildProofStack({
  id: 39,
  formatted_address: "11306 S DRAKE AVE",
  city: "Chicago", state: "IL", zip: "60655", county: "Cook County",
  source: "cook-il-violations",
  lead_score: 80, distress_score: 82,
  owner_name: "TERRENCE SHANKLIN", owner_mailing: "3501 OLYMPUS BLVD #500",
  owner_source: "cook-il-parcel-addresses",
  arv: 314812, repair_estimate: 45000, contract_price: 90000,
}, {
  buyerMatches: [{ name: "ACCEL CAPITAL LLC", max_price: 170000 }, { name: "119TH STREET GROUP LLC", max_price: 225000 }],
  sellerEvidence: { price: 90000, source: "contract_price", confidence: "high" },
});

test("buyer-safe view exposes deal economics, not seller identity/cost", () => {
  const v = buyerSafeProofStack(internalProof);
  assert.equal(v.opportunity_id, "OPP-39");
  assert.equal(v.location.city, "Chicago");
  assert.equal(v.location.zip, "60655");
  assert.equal(v.opportunity_type, "Code violation");
  assert.equal(v.valuation.arv, 314812);
  assert.ok("buyer_assignment_price" in v.economics);
  assert.ok("buyer_acceptance_rating" in v.economics);
  assert.equal(v.demand.interested_investors, 2); // count, not names
  assert.ok(Array.isArray(v.disclosures) && v.disclosures.length >= 2);
});

test("buyer-safe view NEVER leaks seller identity, exact address, our cost, or competing buyer names", () => {
  const v = buyerSafeProofStack(internalProof);
  const blob = JSON.stringify(v);
  // seller / owner identity + contact
  assert.ok(!blob.includes("TERRENCE SHANKLIN"), "owner name leaked");
  assert.ok(!blob.includes("OLYMPUS"), "owner mailing leaked");
  assert.ok(!/owner_name|owner_mailing|owner_source/.test(blob), "owner field leaked");
  // exact street address
  assert.ok(!blob.includes("11306"), "street address leaked");
  assert.ok(!blob.includes("S DRAKE"), "street address leaked");
  // our cost basis / fee / margin
  assert.ok(!/seller_anchor_price|acquisition_offer_price|projected_spread|anchor_spread/.test(blob), "internal price field leaked");
  assert.ok(!blob.includes("90000"), "seller/contract price (our cost) leaked");
  // competing buyer identities
  assert.ok(!blob.includes("ACCEL CAPITAL"), "competing buyer name leaked");
  assert.ok(!blob.includes("119TH STREET"), "competing buyer name leaked");
});

test("buyer-safe view degrades cleanly on an empty/sparse proof", () => {
  const v = buyerSafeProofStack(buildProofStack({ id: 7, source: "sandiego-ca-parcels", lead_score: 40 }));
  assert.equal(v.opportunity_id, "OPP-7");
  assert.equal(v.demand.interested_investors, 0);
  assert.equal(v.confidence.deal_ready, false);
  assert.equal(v.economics.buyer_acceptance_rating, "unknown");
});
