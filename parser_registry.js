// parser_registry.js -- kind -> schema -> parser, the abstraction that makes this an OS for
// anything (NORTH_STAR sec 2 & #7). A `kind` names a schema; the schema declares its joinable
// fields (its "parser"). The SAME engine (field_edges.proposeEdges + route_planner) runs over any
// registered kind via CONFIG ONLY — real estate is just config #1. Add a domain = register a kind,
// not edit the engine. Pure: no I/O.
import { FIELD_JOIN_REGISTRY } from "./field_edges.js";

const REGISTRY = new Map();

/** Register a kind. fieldJoins is the schema's field -> [{to,confidence,reversible}] map. */
export function registerKind(kind, { fieldJoins, schema } = {}) {
  if (!kind || !fieldJoins) throw new Error("registerKind needs a kind and fieldJoins");
  REGISTRY.set(kind, { kind, schema: schema || `${kind}.v1`, fieldJoins });
  return REGISTRY.get(kind);
}
export function getKind(kind) { return REGISTRY.get(kind) || null; }
export function listKinds() { return [...REGISTRY.keys()]; }
export function fieldJoinsFor(kind) { const k = REGISTRY.get(kind); return k ? k.fieldJoins : null; }

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
});
