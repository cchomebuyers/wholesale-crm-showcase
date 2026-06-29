// contact_route_engine.js -- the ContactRouteEngine: one resolver tying the pieces together.
//
//   field_edges.extractFields  -> what we already know about a node
//   route_planner.planRoutes   -> the shortest LEGAL path to the goal field (e.g. a phone)
//   compliance_gate            -> a found contact is never callable until DNC/consent clears
//
// "Given a target and a need, find the shortest legal, evidence-backed path to the right person
// or business, through the best allowed channel — and block illegal outreach." (NORTH_STAR sec 1)
// Pure: no I/O. The server route / connectors execute the chosen path; this plans + gates.

import { planRoutes } from "./route_planner.js";
import { extractFields } from "./field_edges.js";
import { complianceCheck, gateContactCandidate } from "./compliance_gate.js";

/**
 * @param {object} opts
 *   node      - the subject node (property/owner/business) with fields we already know
 *   goal      - the field we want to reach (default "phone")
 *   hasKeys   - provider key presence, e.g. { batchdata_api_key: true }
 *   channels  - requested outreach channels (default all)
 *   candidate - an already-found contact candidate to compliance-gate (optional)
 * @returns route resolution: entity, best_path, fallbacks, compliance, outreach_allowed
 */
export function resolveContactRoute({ node = {}, goal = "phone", hasKeys = {}, channels, candidate = null } = {}) {
  const known = extractFields(node).map((f) => f.field);
  const plan = planRoutes({ goal, known, hasKeys });

  // A contact is only callable if (a) we actually have one and (b) it clears compliance.
  const gated = candidate ? gateContactCandidate(candidate) : null;
  const compliance = candidate
    ? complianceCheck(candidate, { channels })
    : { outreach_allowed: false, allowed_channels: [], reasons: ["no contact candidate yet — run the planned route first"], status: "no_candidate" };

  const blocked_reason = !plan.best_path
    ? "no legal path to goal"
    : !candidate
      ? `path available (${plan.best_path.route}); execute it to obtain the contact`
      : compliance.outreach_allowed ? null : "contact found but not compliance-cleared";

  return {
    entity: { id: node.id || null, kind: node.kind || null, known_fields: known },
    goal,
    best_path: plan.best_path,
    fallback_paths: plan.fallback_paths,
    reachable_fields: plan.reachable_fields,
    contact_candidate: gated,         // always outreach_allowed:false until compliance flips it
    compliance,
    outreach_allowed: compliance.outreach_allowed, // authoritative
    blocked_reason,
  };
}
