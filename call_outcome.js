// call_outcome.js — what happened when the operator actually called.
//
// Closes audit/june30/18-next-actions.md P1 #4: "Add a call outcome model:
// contacted, no answer, wrong number, seller price, offer made, follow-up
// date." Pure module: validation + next-action derivation; persistence and
// routes live in server.js. Every outcome drives a concrete next action so
// the queue never dead-ends after a dial.

export const CALL_OUTCOMES = [
  "contacted",      // reached the seller, no price yet
  "no_answer",      // rang out
  "voicemail",      // left a message
  "wrong_number",   // contact is bad — re-route/skip-trace again
  "seller_price",   // seller named a number
  "offer_made",     // we made an offer
  "follow_up",      // seller asked to talk later
  "do_not_call",    // seller refused contact — hard stop, compliance-relevant
  "dead",           // not a seller / property gone
];

// outcome -> the next action the operator (or engine) should take.
const NEXT_ACTION = {
  contacted:    "qualify motivation + ask price",
  no_answer:    "retry at a different hour (max 3 attempts)",
  voicemail:    "await callback; retry in 2 days",
  wrong_number: "re-run contact route / skip-trace for a fresh number",
  seller_price: "run spread vs MAO; counter or lock up",
  offer_made:   "await response; follow up on the follow-up date",
  follow_up:    "call back on the follow-up date",
  do_not_call:  "STOP - record refusal; suppress all outreach to this contact",
  dead:         "remove from queue; keep as comp/data only",
};

/** Validate + normalize a call outcome submission. Returns
 *  { ok, error? , record? } — record is safe to persist as-is. */
export function normalizeCallOutcome(input = {}) {
  const outcome = String(input.outcome || "").trim();
  if (!CALL_OUTCOMES.includes(outcome)) {
    return { ok: false, error: `outcome must be one of: ${CALL_OUTCOMES.join(", ")}` };
  }
  const rec = {
    outcome,
    next_action: NEXT_ACTION[outcome],
    notes: typeof input.notes === "string" ? input.notes.slice(0, 2000) : null,
    seller_price: null,
    offer_amount: null,
    follow_up_date: null,
    // do_not_call is the only outcome that changes the compliance posture.
    outreach_suppressed: outcome === "do_not_call",
  };

  if (outcome === "seller_price") {
    const p = Number(input.seller_price);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, error: "seller_price outcome requires a positive seller_price" };
    rec.seller_price = p;
  }
  if (outcome === "offer_made") {
    const a = Number(input.offer_amount);
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: "offer_made outcome requires a positive offer_amount" };
    rec.offer_amount = a;
  }
  if (outcome === "follow_up" || outcome === "offer_made") {
    const d = String(input.follow_up_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: `${outcome} requires follow_up_date (YYYY-MM-DD)` };
    rec.follow_up_date = d;
  }
  return { ok: true, record: rec };
}

/** Roll a property's outcome history into queue-facing state.
 *  Latest outcome wins; do_not_call anywhere in history is sticky. */
export function summarizeOutcomes(rows = []) {
  if (!rows.length) return { attempts: 0, last_outcome: null, next_action: null, outreach_suppressed: false };
  const suppressed = rows.some((r) => r.outcome === "do_not_call");
  const last = rows[0]; // caller orders DESC
  return {
    attempts: rows.length,
    last_outcome: last.outcome,
    next_action: suppressed ? NEXT_ACTION.do_not_call : NEXT_ACTION[last.outcome] || null,
    outreach_suppressed: suppressed,
    seller_price: rows.find((r) => r.seller_price != null)?.seller_price ?? null,
    follow_up_date: last.follow_up_date || null,
  };
}
