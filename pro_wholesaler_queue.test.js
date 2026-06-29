// pro_wholesaler_queue.test.js -- the ruthless narrowing gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProQueue, summarizeProQueue, distressSignal, contactState } from "./pro_wholesaler_queue.js";

test("hot distress violation with no owner/phone -> pay_to_unlock (skip-trace spend allowed)", () => {
  const d = classifyProQueue({
    source: "cook-il-violations", lead_score: 71, distress_score: 76, motivation_score: 65,
    owner_name: null, listing_agent_phone: null,
  });
  assert.equal(d.tier, "pay_to_unlock");
  assert.equal(d.spend_allowed, true);
  assert.ok(d.missing.includes("owner"));
});

test("parcel-only weak record -> hold (no spend)", () => {
  const d = classifyProQueue({ source: "sandiego-ca-parcels", lead_score: 42, distress_score: 10 });
  assert.equal(d.tier, "hold");
  assert.equal(d.spend_allowed, false);
  assert.ok(d.signals.parcel_only);
});

test("owner + phone + ARV + buyer demand + working spread -> call_now", () => {
  const d = classifyProQueue({
    source: "cook-il-violations", lead_score: 78,
    owner_name: "Jane Absentee", listing_agent_phone: "3125550100",
    arv: 210000, repair_estimate: 40000, price: 90000, asking_price: 90000, offer_amount: 97000,
    buyer_matches: [{ max_price: 150000 }],
  });
  assert.equal(d.tier, "call_now");
  assert.equal(d.next_action, "call seller / make offer");
  assert.ok(d.signals.buyer_acceptance_score >= 3);
  assert.ok(d.reasons.some((r) => /buyer acceptance/i.test(r)));
});

test("dead buyer acceptance blocks call_now even when spread is positive", () => {
  const d = classifyProQueue({
    source: "cook-il-violations", lead_score: 82,
    owner_name: "Greedy Fee", listing_agent_phone: "3125550199",
    arv: 120000, repair_estimate: 10000, buyer_offer_price: 95000, asking_price: 76000, offer_amount: 75000,
    buyer_matches: [{ max_price: 95000 }],
  });
  assert.notEqual(d.tier, "call_now");
  assert.equal(d.signals.spread_status, "works");
  assert.equal(d.signals.buyer_acceptance_rating, "dead");
  assert.ok(d.reasons.some((r) => /buyer acceptance is dead/i.test(r)));
});

test("score 60-69 missing enrichment -> research (free first, no spend)", () => {
  const d = classifyProQueue({ source: "nyc-ny-violations", lead_score: 64, distress_score: 55 });
  assert.equal(d.tier, "research");
  assert.equal(d.spend_allowed, false);
  assert.ok(d.missing.includes("owner") && d.missing.includes("arv"));
});

test("high score but spread proven to FAIL is not call_now", () => {
  // buyer assignment well below seller anchor with no negotiation room -> fails
  const d = classifyProQueue({
    source: "cook-il-violations", lead_score: 80,
    owner_name: "Owner", listing_agent_phone: "3125550111",
    arv: 100000, repair_estimate: 60000, asking_price: 95000, // formula buyer ~10k, seller wants 95k
  });
  assert.notEqual(d.tier, "call_now");
});

test("distressSignal reads source name and score", () => {
  assert.equal(distressSignal({ source: "la-vacant-buildings" }).fromSource, true);
  assert.equal(distressSignal({ source: "x-parcels", distress_score: 80 }).present, true);
  assert.equal(distressSignal({ source: "x-parcels", distress_score: 5 }).parcelOnly, true);
});

test("contactState recognizes the property pipeline's contact columns", () => {
  assert.equal(contactState({ listing_agent_phone: "3125550100" }).callable, true);
  assert.equal(contactState({ owner_name: "Jane" }).ownerName, true);
  assert.equal(contactState({}).callable, false);
});

test("priority_score rises with contact + value, capped 0-100", () => {
  const bare = classifyProQueue({ source: "cook-il-violations", lead_score: 71 });
  const rich = classifyProQueue({
    source: "cook-il-violations", lead_score: 71,
    owner_name: "X", listing_agent_phone: "3125550100",
    arv: 200000, repair_estimate: 30000, asking_price: 80000, buyer_matches: [{ max_price: 140000 }],
  });
  assert.ok(rich.priority_score > bare.priority_score);
  assert.ok(rich.priority_score <= 100 && bare.priority_score >= 0);
});

test("summarizeProQueue tallies tiers, spend, and missing", () => {
  const decisions = [
    classifyProQueue({ source: "cook-il-violations", lead_score: 71 }),
    classifyProQueue({ source: "x-parcels", lead_score: 30 }),
    classifyProQueue({ source: "nyc-ny-violations", lead_score: 64 }),
  ];
  const s = summarizeProQueue(decisions);
  assert.equal(s.total, 3);
  assert.equal(s.tiers.pay_to_unlock, 1);
  assert.equal(s.tiers.hold, 1);
  assert.equal(s.tiers.research, 1);
  assert.ok(s.top_missing.owner >= 1);
});

test("institutional/govt owner is forced to hold regardless of score", () => {
  const d = classifyProQueue({
    source: "cook-il-violations", lead_score: 80, distress_score: 76,
    owner_name: "CHICAGO TRANSIT AUTHOR", address: "2842 W BELDEN AVE",
  });
  assert.equal(d.tier, "hold");
  assert.ok(d.signals.institutional_owner);
});

test("absentee owner boosts priority over an owner-occupied peer", () => {
  const base = { source: "cook-il-violations", lead_score: 71, distress_score: 76, motivation_score: 65 };
  const absentee = classifyProQueue({ ...base, address: "11306 S DRAKE AVE", owner_name: "TERRENCE SHANKLIN", owner_mailing: "3501 OLYMPUS BLVD#500" });
  const occupied = classifyProQueue({ ...base, address: "1429 N SPRINGFIELD AVE", owner_name: "MIGUEL FLORES", owner_mailing: "1429 N SPRINGFIELD" });
  assert.equal(absentee.signals.absentee_owner, true);
  assert.equal(occupied.signals.absentee_owner, false);
  assert.ok(absentee.priority_score > occupied.priority_score, "absentee should rank higher than owner-occupied");
  assert.ok(absentee.reasons.some((r) => /absentee/i.test(r)));
});

test("B2B/operator phone record is never elevated as a seller lead by this gate", () => {
  // A property-shaped record is what this classifier consumes; a record with no property
  // distress and no property score must fall to hold, never call_now.
  const d = classifyProQueue({ source: "austin-permit-contractors", lead_score: 0, listing_agent_phone: "5125550100" });
  assert.equal(d.tier, "hold");
});
