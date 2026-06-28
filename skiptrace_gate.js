// skiptrace_gate.js -- decide WHEN it is worth spending money to get a seller's phone.
//
// Skip-trace costs money per lookup, so a pro never sprays it across 10,000 records. The
// gate only approves spend on records where everything FREE has already been exhausted and
// the economics justify it: a spend-eligible tier, a known owner (free owner-join done first),
// a real distress signal, and either an ARV or active buyer demand. This is pure decision
// logic — it does NOT call any paid API; it produces the go/no-go + the skip-trace input.
// Wire an actual provider behind `allowed === true` later.

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

function deny(reason) {
  return { allowed: false, max_cost: 0, reason, skiptrace_input: null };
}

/**
 * @param {object} property      - crm.db property row (owner_name, owner_mailing, address, ...)
 * @param {object} queueDecision - result of classifyProQueue (tier, signals, ...)
 * @param {object} [opts]        - { maxCost?: number }  default 0.15 per lookup
 */
export function skiptraceDecision(property = {}, queueDecision = {}, opts = {}) {
  const maxCost = opts.maxCost ?? 0.15;
  const tier = queueDecision.tier;
  const sig = queueDecision.signals || {};
  const ownerKnown = str(property.owner_name).length > 1;

  if (sig.institutional_owner) return deny("institutional/govt/lender owner — not a seller, never spend");
  if (tier !== "pay_to_unlock" && tier !== "call_now") return deny(`tier '${tier}' is not spend-eligible (research/hold go through free enrichment first)`);
  if (!ownerKnown) return deny("owner unknown — run free owner-join before paying for skip-trace");
  if (!sig.distress_present) return deny("no distress signal — not motivated enough to spend");
  if (!sig.arv && !sig.buyer_demand) return deny("no ARV and no buyer demand — research (free) before paid skip-trace");

  const why = [
    `tier=${tier}`,
    "owner known",
    "distress present",
    sig.arv ? "ARV present" : null,
    sig.buyer_demand ? "buyer demand" : null,
    sig.absentee_owner ? "absentee owner" : null,
  ].filter(Boolean).join(", ");

  return {
    allowed: true,
    max_cost: maxCost,
    reason: why,
    skiptrace_input: {
      owner_name: property.owner_name,
      property_address: property.address || property.formatted_address || null,
      mailing_address: property.owner_mailing || null,
    },
    // The result remains compliance-gated downstream: any phone found is outreach_allowed:false
    // until DNC/consent is checked. Skip-trace finding a number does NOT authorize a call.
    compliance_note: "phone (if found) stays outreach_allowed:false until DNC/consent verified",
  };
}

/** Summarize a batch of gate decisions (e.g. estimate the spend to unlock the queue). */
export function summarizeSkiptrace(decisions = [], opts = {}) {
  const maxCost = opts.maxCost ?? 0.15;
  const allowed = decisions.filter((d) => d.allowed).length;
  return { total: decisions.length, allowed, denied: decisions.length - allowed, est_max_spend: Math.round(allowed * maxCost * 100) / 100 };
}
