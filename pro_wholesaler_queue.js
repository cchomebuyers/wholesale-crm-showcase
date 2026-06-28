// pro_wholesaler_queue.js -- turn a big property database into a pro wholesaler's
// operating queue. A working wholesaler does not want 10,000 vague records; they want
// a ruthless split: a tiny "call now" list, a "pay to unlock" (skip-trace) list, a
// "research" pile, and a large "hold" bucket they can ignore.
//
// This module is PURE: it takes one property record (plain object, e.g. a crm.db
// `properties` row) plus an optional spread audit (from wholesale_spread.js) and
// returns a tier decision. No I/O, no DB. The runner (tools/build_pro_queue.mjs) and
// the server route own persistence.
//
// Tiers (highest attention first):
//   call_now      -- contact known + value known + spread path that can work -> dial today
//   pay_to_unlock -- real distress + score >=70 but missing owner/phone -> worth paid skip-trace
//   research      -- interesting (score >=60) but missing owner/ARV/buyer -> free research first
//   hold          -- parcel-only / weak / no distress -> ignore until something changes

import { evaluateWholesaleSpread } from "./wholesale_spread.js";
import { deriveSignals } from "./property_signals.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => str(v).length > 0;

// A source name tells us a lot about motivation. Violation / vacant / abandoned /
// condemned / tax-delinquent / foreclosure / probate sources are real distress signals.
// Pure parcel/assessor rolls are context, not motivation, unless something else flags them.
const DISTRESS_RX = /violation|vacant|abandon|condemn|demol|blight|delinquen|forecl|probate|lien|nuisance|unsafe|code[_-]?enforce/i;
const PARCEL_ONLY_RX = /parcel|assessor|tax[_-]?roll|cadastr/i;

export function distressSignal(record = {}) {
  const source = str(record.source) || str(record.source_id);
  const fromSource = DISTRESS_RX.test(source);
  const distressScore = num(record.distress_score);
  const motivation = num(record.motivation_score);
  const strongScore = (distressScore != null && distressScore >= 60) ||
    (motivation != null && motivation >= 60);
  return {
    present: fromSource || strongScore,
    fromSource,
    distressScore,
    motivation,
    parcelOnly: PARCEL_ONLY_RX.test(source) && !fromSource && !strongScore,
    label: fromSource ? source : strongScore ? "score_signal" : "none",
  };
}

// Do we have a way to actually reach a seller? Owner name is the anchor; a phone/email
// (listing_agent_* is the contact column the property pipeline writes) makes it callable.
export function contactState(record = {}) {
  const ownerName = has(record.owner_name);
  const ownerMailing = has(record.owner_mailing);
  const phone = has(record.listing_agent_phone) || has(record.seller_phone) || has(record.phone);
  const email = has(record.listing_agent_email) || has(record.seller_email) || has(record.email);
  return { ownerName, ownerMailing, phone, email, callable: phone || email };
}

// Is there any value/demand evidence to know this can make money?
export function valueState(record = {}, spread) {
  const arv = num(record.arv);
  const mao = num(record.mao);
  const buyerMatches = Array.isArray(record.buyer_matches) ? record.buyer_matches.length : 0;
  const spreadStatus = spread?.status || null; // works | thin | fails | unproven
  const spreadCanWork = spreadStatus === "works" || spreadStatus === "thin";
  return {
    arv: arv != null && arv > 0,
    mao: mao != null && mao > 0,
    buyerDemand: buyerMatches > 0,
    spreadStatus,
    spreadCanWork,
    valueKnown: (arv != null && arv > 0) || buyerMatches > 0 || spreadCanWork,
  };
}

// priority_score: a single 0-100 ranking number inside a tier. Built from the existing
// lead_score with bumps for the things a wholesaler actually values: real contact,
// known value, and a spread that can work.
function priorityScore(record, dist, contact, value, sig) {
  let s = num(record.lead_score) ?? num(record.wholesale_score) ?? num(record.distress_score) ?? 0;
  if (dist.fromSource) s += 4;
  if (contact.ownerName) s += 6;
  if (contact.callable) s += 8;
  if (value.arv) s += 6;
  if (value.buyerDemand) s += 6;
  if (value.spreadStatus === "works") s += 8;
  else if (value.spreadStatus === "thin") s += 4;
  if (sig) s += sig.signal_score; // absentee/entity boost; institutional penalty
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * Classify one property into a pro-wholesaler queue tier.
 * @param {object} record  - a property row (crm.db properties) or normalized property
 * @param {object} [opts]  - { spread?, minScore?, hotScore?, spreadOptions? }
 * @returns {{tier,priority_score,missing,reasons,next_action,spend_allowed,signals}}
 */
export function classifyProQueue(record = {}, opts = {}) {
  const hotScore = opts.hotScore ?? 70;
  const researchScore = opts.minScore ?? 60;
  const leadScore = num(record.lead_score) ?? num(record.wholesale_score) ?? num(record.distress_score) ?? 0;

  const dist = distressSignal(record);
  const contact = contactState(record);
  const sig = deriveSignals(record);
  // Spread audit is optional; compute from the record if not supplied.
  const spread = opts.spread ?? (opts.skipSpread ? null : safeSpread(record, opts.spreadOptions));
  const value = valueState(record, spread);

  const missing = [];
  if (!contact.ownerName) missing.push("owner");
  if (!contact.callable) missing.push("seller_phone");
  if (!value.arv) missing.push("arv");
  if (!value.buyerDemand) missing.push("buyer_demand");

  const reasons = [];
  let tier, next_action, spend_allowed = false;

  if (sig.institutional_owner) {
    // city/county/authority/transit/bank owner is not a seller lead, regardless of score.
    tier = "hold";
    next_action = "hold (institutional/govt/lender owner — not a seller)";
    reasons.push(...sig.reasons);
  } else if (leadScore >= hotScore && contact.callable && value.valueKnown && value.spreadStatus !== "fails") {
    // Everything a wholesaler needs to dial: reach, value, and a spread that isn't dead.
    tier = "call_now";
    next_action = "call seller / make offer";
    reasons.push(`score ${leadScore} >= ${hotScore}, contact + value present`);
    if (value.spreadStatus) reasons.push(`spread path: ${value.spreadStatus}`);
  } else if (leadScore >= hotScore && dist.present && (!contact.callable || !contact.ownerName)) {
    // High-intent distress but we can't reach them yet -> this is what skip-trace is for.
    tier = "pay_to_unlock";
    spend_allowed = true;
    next_action = contact.ownerName ? "skip-trace owner for phone" : "owner join then skip-trace";
    reasons.push(`score ${leadScore} >= ${hotScore} + distress (${dist.label}); missing ${(!contact.ownerName ? "owner" : "phone")}`);
  } else if (leadScore >= researchScore && !dist.parcelOnly && (missing.length > 0)) {
    // Worth free research (owner join / ARV / buyers) before spending money.
    tier = "research";
    next_action = "free enrichment: owner join, ARV/comps, buyer match";
    reasons.push(`score ${leadScore} >= ${researchScore}; needs ${missing.join(", ") || "review"}`);
  } else {
    tier = "hold";
    next_action = "hold (re-evaluate if a new signal appears)";
    if (dist.parcelOnly) reasons.push("parcel-only record, no distress signal");
    else if (leadScore < researchScore) reasons.push(`score ${leadScore} < ${researchScore}`);
    else reasons.push("no actionable signal yet");
  }

  if (!sig.institutional_owner) for (const r of sig.reasons) if (!reasons.includes(r)) reasons.push(r);

  return {
    tier,
    priority_score: priorityScore(record, dist, contact, value, sig),
    missing,
    reasons,
    next_action,
    spend_allowed,
    signals: {
      lead_score: leadScore,
      distress: dist.label,
      distress_present: dist.present,
      parcel_only: dist.parcelOnly,
      owner: contact.ownerName,
      callable: contact.callable,
      arv: value.arv,
      buyer_demand: value.buyerDemand,
      spread_status: value.spreadStatus,
      absentee_owner: sig.absentee_owner,
      entity_owner: sig.entity_owner,
      institutional_owner: sig.institutional_owner,
      signal_score: sig.signal_score,
    },
  };
}

function safeSpread(record, spreadOptions) {
  try {
    return evaluateWholesaleSpread(record, spreadOptions || {});
  } catch {
    return null;
  }
}

const TIER_ORDER = ["call_now", "pay_to_unlock", "research", "hold"];

/** Roll a batch of classifications into a summary the way a wholesaler reads it. */
export function summarizeProQueue(decisions = []) {
  const tiers = { call_now: 0, pay_to_unlock: 0, research: 0, hold: 0 };
  const missing = {};
  let spendAllowed = 0;
  for (const d of decisions) {
    tiers[d.tier] = (tiers[d.tier] || 0) + 1;
    if (d.spend_allowed) spendAllowed += 1;
    for (const m of d.missing || []) missing[m] = (missing[m] || 0) + 1;
  }
  return { total: decisions.length, tiers, tier_order: TIER_ORDER, spend_allowed: spendAllowed, top_missing: missing };
}
