// parser_registry.js -- kind -> schema -> parser, the abstraction that makes this an OS for
// anything (NORTH_STAR sec 2 & #7). A `kind` names a schema; the schema declares its joinable
// fields (its "parser"). The SAME engine (field_edges.proposeEdges + route_planner) runs over any
// registered kind via CONFIG ONLY — real estate is just config #1. Add a domain = register a kind,
// not edit the engine. Pure: no I/O.
import { FIELD_JOIN_REGISTRY } from "./field_edges.js";

const REGISTRY = new Map();

/** Register a kind. fieldJoins is the schema's field -> [{to,confidence,reversible}] map.
 *  routeFamilies (optional) lets a domain plan contact routes over its own kinds. */
export function registerKind(kind, { fieldJoins, schema, routeFamilies = null } = {}) {
  if (!kind || !fieldJoins) throw new Error("registerKind needs a kind and fieldJoins");
  REGISTRY.set(kind, { kind, schema: schema || `${kind}.v1`, fieldJoins, routeFamilies });
  return REGISTRY.get(kind);
}
export function getKind(kind) { return REGISTRY.get(kind) || null; }
export function listKinds() { return [...REGISTRY.keys()]; }
export function fieldJoinsFor(kind) { const k = REGISTRY.get(kind); return k ? k.fieldJoins : null; }
export function routeFamiliesFor(kind) { const k = REGISTRY.get(kind); return k ? k.routeFamilies : null; }

// ---- config #1: real estate (reuse the built-in field-join registry) ----
registerKind("realEstate", { schema: "realEstate.v1", fieldJoins: FIELD_JOIN_REGISTRY });

// ---- config #2: small-business / operator domain (proof the engine is domain-agnostic) ----
// Entirely different fields and target kinds; ZERO engine changes — just this config.
registerKind("smb", {
  schema: "smb.v1",
  fieldJoins: {
    business_name: [{ to: "business", confidence: 0.85, reversible: true }, { to: "person", confidence: 0.4, reversible: false }],
    address:       [{ to: "location", confidence: 0.8, reversible: true }],
    phone:         [{ to: "contact", confidence: 0.8, reversible: true }],
    email:         [{ to: "contact", confidence: 0.8, reversible: true }],
    website:       [{ to: "domain", confidence: 0.9, reversible: true }],
    owner_name:    [{ to: "person", confidence: 0.6, reversible: false }],
    license_id:    [{ to: "license", confidence: 0.95, reversible: true }],
  },
  // smb route families: reuse the same GREEN sources via route_planner.planRoutes({ routeFamilies }).
  routeFamilies: [
    { id: "smb_address_license_phone", produces: ["phone"], requires: ["address"], source: "business_license", steps: ["match_license_by_address"], base_confidence: 0.72 },
    { id: "smb_name_sos_agent", produces: ["registered_agent"], requires: ["business_name"], source: "secretary_of_state", steps: ["lookup_entity", "resolve_registered_agent"], base_confidence: 0.7 },
  ],
});
