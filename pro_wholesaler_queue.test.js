// pro_wholesaler_queue.test.js -- the ruthless narrowing gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProQueue, summarizeProQueue, distressSignal, contactState, whyNotCallNow, CALL_NOW_BLOCKER_KEYS } from "./pro_wholesaler_queue.js";

const keys = (blockers) => blockers.map((b) => b.key);

// A property that has cleared every blocker, including a VERIFIED DNC/consent.
const READY = {
  source: "cook-il-violations", lead_score: 78,
  owner_name: "Jane Absentee", listing_agent_phone: "3125550100",
  dnc_status: "clear", // <- the only thing that makes a phone legally callable
  arv: 210000, repair_estimate: 40000, price: 90000, asking_price: 90000, offer_amount: 97000,
  buyer_matches: [{ max_price: 150000 }],
};

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

test("why_not_call_now: empty record lists every non-contact blocker in operator order", () => {
  const w = whyNotCallNow({});
  // No phone -> contact_missing (NOT dnc_consent_missing, which needs a number first).
  assert.deepEqual(keys(w), [
    "owner_missing", "contact_missing", "arv_mao_missing",
    "buyer_demand_missing", "seller_price_missing", "proof_incomplete",
  ]);
  assert.ok(!keys(w).includes("dnc_consent_missing"));
});

test("why_not_call_now: a phone with UNVERIFIED DNC/consent stays blocked (hard rule)", () => {
  const w = whyNotCallNow({ ...READY, dnc_status: undefined });
  assert.ok(keys(w).includes("dnc_consent_missing"), "phone present but DNC unchecked must block");
  assert.ok(!keys(w).includes("contact_missing"), "contact exists, so it is not contact_missing");
});

test("why_not_call_now: fully proven property with DNC clear has ZERO blockers (call-now-ready)", () => {
  const w = whyNotCallNow(READY);
  assert.deepEqual(w, [], `expected no blockers, got ${JSON.stringify(keys(w))}`);
});

test("why_not_call_now: institutional/govt owner is the leading hard-stop blocker", () => {
  const w = whyNotCallNow({ ...READY, owner_name: "CHICAGO TRANSIT AUTHORITY", address: "2842 W BELDEN AVE" });
  assert.equal(keys(w)[0], "not_a_seller");
});

test("why_not_call_now: every emitted key is part of the published blocker catalog", () => {
  const w = whyNotCallNow({ owner_name: "X", listing_agent_phone: "3125550100" });
  for (const k of keys(w)) assert.ok(CALL_NOW_BLOCKER_KEYS.includes(k), `${k} must be a known blocker key`);
});

test("why_not_call_now: works off a precomputed signals object (server pro-queue row)", () => {
  // Row shape the /api/pro-queue route builds: columns + parsed signals.
  const row = {
    owner_name: "Jane", listing_agent_phone: "3125550100", dnc_status: "clear",
    arv: 200000, mao: 120000, asking_price: 90000,
    signals: { owner: true, callable: true, arv: true, buyer_demand: false, spread_status: "works", institutional_owner: false },
  };
  const w = whyNotCallNow(row, { signals: row.signals });
  assert.deepEqual(keys(w), ["buyer_demand_missing"], "only buyer demand should be missing here");
});

test("classifyProQueue exposes why_not_call_now + call_now_ready", () => {
  const ready = classifyProQueue(READY);
  assert.equal(ready.call_now_ready, true);
  assert.deepEqual(ready.why_not_call_now, []);

  const blocked = classifyProQueue({ source: "nyc-ny-violations", lead_score: 64 });
  assert.equal(blocked.call_now_ready, false);
  assert.ok(blocked.why_not_call_now.length > 0);
  assert.ok(blocked.why_not_call_now.every((b) => b.key && b.label && b.fix));
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

test("priority_score prefers property_grade as ranking base when present, identical when absent", () => {
  // Two same-source records: a higher property_grade must rank higher within the tier.
  const base = { source: "cook-il-violations", lead_score: 64, distress_score: 68, owner_name: "ACME LLC", address: "1 A ST", owner_mailing: "9 B ST" };
  const high = classifyProQueue({ ...base, property_grade: 80 });
  const low = classifyProQueue({ ...base, property_grade: 40 });
  assert.ok(high.priority_score > low.priority_score, `grade 80 (${high.priority_score}) should outrank grade 40 (${low.priority_score})`);
  // Guard: absent property_grade -> unchanged behavior (does not throw, still ranks).
  const none = classifyProQueue({ ...base });
  assert.ok(Number.isFinite(none.priority_score));
});
