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
import { complianceCheck } from "./compliance_gate.js";

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
  const acceptance = spread?.buyerAcceptance || spread?.buyer_acceptance || null;
  const acceptanceScore = num(acceptance?.score ?? spread?.buyer_acceptance_score);
  const acceptanceRating = str(acceptance?.rating ?? spread?.buyer_acceptance_rating) || null;
  const acceptanceDead = acceptanceRating === "dead" || (acceptanceScore != null && acceptanceScore < 1);
  const acceptanceTargetMet = acceptanceScore != null && acceptanceScore >= 3;
  return {
    arv: arv != null && arv > 0,
    mao: mao != null && mao > 0,
    buyerDemand: buyerMatches > 0,
    spreadStatus,
    spreadCanWork,
    acceptance,
    acceptanceScore,
    acceptanceRating,
    acceptanceDead,
    acceptanceTargetMet,
    valueKnown: (arv != null && arv > 0) || buyerMatches > 0 || spreadCanWork,
  };
}

// ---------------------------------------------------------------------------
// why_not_call_now — the operator-facing explanation of EXACTLY what is blocking a
// property from the `call_now` tier, and the cheapest next action to unblock it.
//
// LOOP_PROMPT 07 ("Make the live product explain why each property is not yet
// call_now"): a property reaches call_now only when every blocker below is cleared.
// The order is the operator's free-work sequence (do the cheapest unblock first),
// and matches the seven evidence pillars (proof_stack.js PILLARS) plus the
// institutional hard-stop and the DNC/consent compliance gate (compliance_gate.js).
//
// Hard rule (CLAUDE.md ground rule 2 / LOOP_PROMPT): a found phone is NEVER callable
// until DNC + consent clear. So a property with a phone but no verified DNC/consent
// still reports `dnc_consent_missing` and is NOT call_now. This function only
// REPORTS blockers — it never marks a contact callable.
export const CALL_NOW_BLOCKERS = [
  { key: "not_a_seller",         label: "Owner is institutional/govt/lender — not a seller lead",          fix: "drop from the seller pipeline (institutional owner never calls)" },
  { key: "owner_missing",        label: "Owner identity unknown",                                          fix: "free owner-join (assessor/parcel) before any spend" },
  { key: "contact_missing",      label: "No phone or email on file",                                       fix: "free contact enrichment; if still none, skip-trace gate (paid) once owner+distress+value present" },
  { key: "dnc_consent_missing",  label: "Contact present but not cleared to call (DNC/consent unverified)", fix: "run DNC scrub + confirm consent; until then mail-only (outreach_allowed:false)" },
  { key: "arv_mao_missing",      label: "No ARV/MAO valuation",                                            fix: "free comps → ARV → MAO" },
  { key: "buyer_demand_missing", label: "No matched buyer demand",                                         fix: "match buy-boxes / discover buyers for the area + property type" },
  { key: "seller_price_missing", label: "No seller price evidence",                                        fix: "capture asking/contract price or run seller intake" },
  { key: "proof_incomplete",     label: "Assignment spread not yet proven to work",                        fix: "complete the proof stack (comps→ARV→MAO→buyer price) so the spread holds" },
];
export const CALL_NOW_BLOCKER_KEYS = CALL_NOW_BLOCKERS.map((b) => b.key);
const BLOCKER_BY_KEY = Object.fromEntries(CALL_NOW_BLOCKERS.map((b) => [b.key, b]));

// Any seller price evidence on the record (numeric > 0 or a stored evidence object).
function sellerPricePresent(record = {}) {
  if (record.seller_price_evidence) return true;
  for (const k of ["seller_acceptable_price", "contract_price", "asking_price", "price", "offer_amount"]) {
    const n = num(record[k]);
    if (n != null && n > 0) return true;
  }
  return false;
}

// Is the contact legally callable RIGHT NOW? Routes through the authoritative
// compliance gate (call/sms channels). Default DENY: without verified DNC/consent
// this returns false even when a phone exists (the gate is authoritative).
function callContactAllowed(record = {}) {
  const phone = str(record.listing_agent_phone) || str(record.seller_phone) || str(record.phone);
  const email = str(record.listing_agent_email) || str(record.seller_email) || str(record.email);
  const cc = complianceCheck(
    {
      phone, email,
      dnc_status: record.dnc_status,
      sms_consent: record.sms_consent === true,
      email_consent: record.email_consent === true,
      opt_out: record.opt_out === true,
    },
    { channels: ["call", "sms"] },
  );
  return cc.outreach_allowed;
}

// Resolve the call_now facts from either a raw property record OR a queue row that
// carries a precomputed `signals` object (server route). Owner/contact/ARV/MAO/
// seller-price are read from the record columns (authoritative current DB state);
// buyer-demand, spread status, and institutional-owner come from `signals` when
// supplied (they need buyer-match/spread context not on a plain row), else are
// computed from the record.
function callNowFacts(record = {}, opts = {}) {
  const sig = opts.signals && typeof opts.signals === "object" ? opts.signals : null;
  const contact = contactState(record);
  // On a raw record (no precomputed signals) compute the spread ourselves so the
  // proof/spread blocker is real — mirrors classifyProQueue's safeSpread default.
  const spread = sig ? null : (opts.spread ?? safeSpread(record, opts.spreadOptions));
  const value = sig ? null : valueState(record, spread);
  const institutional = sig ? !!sig.institutional_owner : !!deriveSignals(record).institutional_owner;
  const hasContact = sig ? !!sig.callable : contact.callable;
  const spreadStatus = sig ? (sig.spread_status ?? null) : value.spreadStatus;
  return {
    institutional,
    ownerKnown: contact.ownerName,
    hasContact,
    complianceCleared: hasContact ? callContactAllowed(record) : false,
    hasArvMao: (num(record.arv) ?? 0) > 0 || (num(record.mao) ?? 0) > 0 || (sig ? !!sig.arv : value.arv),
    hasBuyerDemand: sig ? !!sig.buyer_demand : value.buyerDemand,
    hasSellerPrice: sellerPricePresent(record),
    spreadStatus,
    spreadProven: spreadStatus === "works" || spreadStatus === "thin",
  };
}

/**
 * Ordered list of blockers keeping a property out of the `call_now` tier.
 * PURE — no I/O. Returns [] when the property is call-now-ready.
 * @param {object} record - a property row OR a /api/pro-queue row
 * @param {object} [opts] - { signals?, spread? } pass a precomputed signals object
 *                          (from classifyProQueue) to reuse buyer-demand/spread/owner facts
 * @returns {Array<{key,label,fix}>} blockers in operator free-work order
 */
export function whyNotCallNow(record = {}, opts = {}) {
  const f = callNowFacts(record, opts);
  const out = [];
  if (f.institutional) out.push(BLOCKER_BY_KEY.not_a_seller);
  if (!f.ownerKnown) out.push(BLOCKER_BY_KEY.owner_missing);
  if (!f.hasContact) out.push(BLOCKER_BY_KEY.contact_missing);
  else if (!f.complianceCleared) out.push(BLOCKER_BY_KEY.dnc_consent_missing);
  if (!f.hasArvMao) out.push(BLOCKER_BY_KEY.arv_mao_missing);
  if (!f.hasBuyerDemand) out.push(BLOCKER_BY_KEY.buyer_demand_missing);
  if (!f.hasSellerPrice) out.push(BLOCKER_BY_KEY.seller_price_missing);
  if (!f.spreadProven) out.push(BLOCKER_BY_KEY.proof_incomplete);
  return out.map((b) => ({ ...b }));
}

// The seller said do-not-call (call_outcome.js records outreach_suppressed).
// That refusal is ABSOLUTE: it outranks every other fact, so it is prepended
// as a terminal blocker and the row can never read call_now_ready. Pure so
// the queue route and tests share one implementation.
export const SUPPRESSED_BLOCKER = Object.freeze({
  key: "outreach_suppressed",
  label: "seller refused contact (do-not-call)",
  fix: "none — outreach permanently suppressed for this property",
});

export function applyOutreachSuppression(item, suppressedIds) {
  if (!suppressedIds || !suppressedIds.has(item.property_id)) return item;
  const already = (item.why_not_call_now || []).some((b) => b.key === SUPPRESSED_BLOCKER.key);
  return {
    ...item,
    why_not_call_now: already ? item.why_not_call_now : [{ ...SUPPRESSED_BLOCKER }, ...(item.why_not_call_now || [])],
    call_now_ready: false,
    next_action: "do_not_contact",
  };
}

// priority_score: a single 0-100 ranking number inside a tier. Built from the existing
// lead_score with bumps for the things a wholesaler actually values: real contact,
// known value, and a spread that can work.
function priorityScore(record, dist, contact, value, sig) {
  // Prefer the per-property grade (property_score.js, stored as property_grade) when present:
  // it already differentiates owner signals + value/equity + portfolio, replacing the FLAT
  // per-source lead_score base. Guarded — when property_grade is absent, behavior is identical
  // to before (lead_score*0.5 base + sig.signal_score). When present, we do NOT re-add
  // sig.signal_score to avoid double-counting owner signals already inside the grade.
  const grade = num(record.property_grade);
  let s = grade !== null
    ? grade
    : (num(record.lead_score) ?? num(record.wholesale_score) ?? num(record.distress_score) ?? 0) * 0.5;
  if (dist.fromSource) s += 4;
  if (contact.ownerName) s += 6;
  if (contact.callable) s += 8;
  if (value.arv) s += 6;
  if (value.buyerDemand) s += 6;
  if (value.spreadStatus === "works") s += 8;
  else if (value.spreadStatus === "thin") s += 4;
  if (value.acceptanceTargetMet) s += 5;
  else if (value.acceptanceDead) s -= 10;
  if (sig && grade === null) s += sig.signal_score; // grade already includes owner signals
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
  } else if (leadScore >= hotScore && contact.callable && value.valueKnown && value.spreadStatus !== "fails" && !value.acceptanceDead) {
    // Everything a wholesaler needs to dial: reach, value, and a spread that isn't dead.
    tier = "call_now";
    next_action = "call seller / make offer";
    reasons.push(`score ${leadScore} >= ${hotScore}, contact + value present`);
    if (value.spreadStatus) reasons.push(`spread path: ${value.spreadStatus}`);
    if (value.acceptanceScore != null) {
      reasons.push(`buyer acceptance ${value.acceptanceScore}x (${value.acceptanceRating})`);
    }
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
  if (value.acceptanceDead) reasons.push("buyer acceptance is dead: fee consumes buyer upside");
  else if (value.acceptanceScore != null && value.acceptanceScore < 3) {
    reasons.push(`buyer acceptance below 3x target: ${value.acceptanceScore}x (${value.acceptanceRating})`);
  }

  const signals = {
    lead_score: leadScore,
    distress: dist.label,
    distress_present: dist.present,
    parcel_only: dist.parcelOnly,
    owner: contact.ownerName,
    callable: contact.callable,
    arv: value.arv,
    buyer_demand: value.buyerDemand,
    spread_status: value.spreadStatus,
    buyer_acceptance_score: value.acceptanceScore,
    buyer_acceptance_rating: value.acceptanceRating,
    buyer_projected_profit: value.acceptance?.profit ?? spread?.buyer_projected_profit ?? null,
    absentee_owner: sig.absentee_owner,
    entity_owner: sig.entity_owner,
    institutional_owner: sig.institutional_owner,
    signal_score: sig.signal_score,
  };

  // Operator visibility: the exact ordered blockers keeping this off `call_now`.
  const why_not_call_now = whyNotCallNow(record, { signals, spread });

  return {
    tier,
    priority_score: priorityScore(record, dist, contact, value, sig),
    missing,
    reasons,
    next_action,
    spend_allowed,
    call_now_ready: why_not_call_now.length === 0,
    why_not_call_now,
    signals,
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
