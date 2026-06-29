// route_planner.js -- the heart of the ContactRouteEngine.
//
// Generalizes owner-join + skip-trace into a single legal pathfinder: given a target, a goal,
// and which fields we already know, score and rank the route families that can reach the goal —
// preferring the shortest LEGAL, highest-confidence, lowest-cost path. A path may be longer if it
// is safer/cheaper/more confident. RED sources are never planned. Pure: no I/O. The engine
// (contact_route_engine.js) and connectors execute the chosen path; this only plans + scores.

import policy from "./source_policy_registry.json" with { type: "json" };

// Route families: each declares what it needs, what it produces, and which policy source it uses.
export const ROUTE_FAMILIES = [
  { id: "address_to_parcel_to_owner", produces: ["owner_name", "mailing_address", "parcel_id"], requires: ["address"], source: "county_assessor", steps: ["normalize_address", "resolve_parcel", "resolve_owner"], base_confidence: 0.84 },
  { id: "owner_llc_to_sos_agent", produces: ["registered_agent", "registered_office"], requires: ["owner_name"], source: "secretary_of_state", steps: ["lookup_entity", "resolve_registered_agent"], base_confidence: 0.70 },
  { id: "address_business_license_phone", produces: ["phone", "business_name"], requires: ["address"], source: "business_license", steps: ["match_license_by_address"], base_confidence: 0.72 },
  { id: "address_permit_contact", produces: ["phone", "email", "name"], requires: ["address"], source: "permits", steps: ["match_permit_by_address"], base_confidence: 0.60 },
  { id: "owner_address_skiptrace", produces: ["phone", "email"], requires: ["owner_name", "address"], source: "paid_skiptrace", steps: ["skiptrace", "dnc_filter"], base_confidence: 0.86 },
  { id: "first_party_consent", produces: ["phone", "email", "consent"], requires: ["consent"], source: "first_party", steps: ["intake_form"], base_confidence: 0.95 },
];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Cost (lower is better): money + legal risk + false-match risk + latency + manual effort
//   - confidence bonus - first-party-consent bonus. Planner may pick a longer/pricier path only
// if its risk/confidence makes the total lower.
export function scoreRoute(route, src, { knownSet }) {
  const falseMatchRisk = 1 - num(route.base_confidence, 0.5);
  const consentBonus = route.id === "first_party" ? 1.5 : 0;
  const cost =
    num(src.cost) +
    num(src.legal_risk) * 2 +
    falseMatchRisk +
    num(src.latency) * 0.1 +
    num(src.manual_effort) * 0.1 -
    num(route.base_confidence) -
    consentBonus;
  return Math.round(cost * 1000) / 1000;
}

/**
 * Plan legal routes to a goal field.
 * @param {object} opts
 *   goal       - field we want (e.g. "phone", "owner_name", "registered_agent")
 *   known      - array of fields already known (e.g. ["address","owner_name"])
 *   maxCost    - optional cap on planned cost
 *   hasKeys    - map of provider key presence, e.g. { batchdata_api_key: true }
 *   sourcePolicy - override policy (defaults to source_policy_registry.json)
 * @returns { goal, best_path, fallback_paths, all, reachable_fields }
 */
export function planRoutes({ goal, known = [], maxCost = null, hasKeys = {}, sourcePolicy = policy } = {}) {
  const sources = sourcePolicy.sources || {};
  const knownSet = new Set(known);

  // Reachable fields: known ∪ everything a GREEN/YELLOW route (whose requires are met) can produce.
  // One expansion pass enables 2-hop chains (address -> owner -> [owner+address] -> skiptrace).
  const reachable = new Set(knownSet);
  for (let pass = 0; pass < ROUTE_FAMILIES.length; pass++) {
    let grew = false;
    for (const r of ROUTE_FAMILIES) {
      const src = sources[r.source];
      if (!src || src.class === "RED") continue;
      if (r.requires.every((f) => reachable.has(f))) {
        for (const p of r.produces) if (!reachable.has(p)) { reachable.add(p); grew = true; }
      }
    }
    if (!grew) break;
  }

  const candidates = ROUTE_FAMILIES.filter((r) => r.produces.includes(goal));
  const planned = candidates.map((r) => {
    const src = sources[r.source];
    const blocked = [];
    if (!src) blocked.push("unknown source policy");
    else if (src.class === "RED") blocked.push("RED source — never planned");
    const requiresMet = r.requires.every((f) => knownSet.has(f));
    const requiresReachable = r.requires.every((f) => reachable.has(f));
    if (!requiresMet && !requiresReachable) blocked.push(`missing inputs: ${r.requires.filter((f) => !reachable.has(f)).join(", ")}`);
    if (src && src.requires_key && !hasKeys[src.requires_key]) blocked.push(`needs ${src.requires_key}`);
    const cost = src && src.class !== "RED" ? scoreRoute(r, src, { knownSet }) : Infinity;
    if (maxCost != null && Number.isFinite(cost) && cost > maxCost) blocked.push(`cost ${cost} > max ${maxCost}`);
    return {
      route: r.id,
      goal,
      steps: r.steps,
      source: r.source,
      class: src ? src.class : "UNKNOWN",
      confidence: r.base_confidence,
      cost,
      legal_risk: src ? num(src.legal_risk) : 1,
      allowed_channels: src ? (src.channels || []) : [],
      needs_precursor: !requiresMet && requiresReachable,
      available: blocked.length === 0,
      outreach_allowed: false, // ALWAYS — compliance gate decides later; a found contact is not callable
      blocked_reason: blocked.length ? blocked.join("; ") : null,
    };
  });

  const available = planned.filter((p) => p.available).sort((a, b) => a.cost - b.cost);
  const blocked = planned.filter((p) => !p.available).sort((a, b) => a.cost - b.cost);
  return {
    goal,
    best_path: available[0] || null,
    fallback_paths: available.slice(1).concat(blocked),
    all: planned,
    reachable_fields: [...reachable],
  };
}
