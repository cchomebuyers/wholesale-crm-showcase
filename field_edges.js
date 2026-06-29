// field_edges.js -- the identity-graph core: "nodes store facts, fields propose edges."
//
// Every node (property, owner, business, contact, ...) both stores its own facts AND exposes
// joinable fields. Each field is a possible doorway to another node. Ingestion is not "save a
// record" — it is: extract fields -> normalize -> propose CANDIDATE edges -> score confidence ->
// keep provenance. A field match is NOT a confirmed link; it's a candidate the graph must
// validate with evidence. The graph remembers uncertainty. This is the abstract substrate
// (kind = schema -> parser registry); real estate is just config #1. Pure: no I/O.

const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// FIELD_JOIN_REGISTRY: per field, what node types it can reach and the base confidence of that
// candidate edge. Abstract + data-driven so a new domain is config, not code. "reversible" means
// the edge can be confidently traversed both ways (double link); else it's a single link.
export const FIELD_JOIN_REGISTRY = {
  address:        [{ to: "property", confidence: 0.9, reversible: true }, { to: "business", confidence: 0.4, reversible: false }],
  parcel_id:      [{ to: "property", confidence: 0.97, reversible: true }],
  owner_name:     [{ to: "person", confidence: 0.6, reversible: false }, { to: "business", confidence: 0.5, reversible: false }, { to: "property", confidence: 0.55, reversible: false }],
  mailing_address:[{ to: "person", confidence: 0.5, reversible: false }, { to: "business", confidence: 0.45, reversible: false }],
  business_name:  [{ to: "business", confidence: 0.85, reversible: true }, { to: "person", confidence: 0.4, reversible: false }],
  phone:          [{ to: "contact", confidence: 0.8, reversible: true }, { to: "person", confidence: 0.5, reversible: false }, { to: "business", confidence: 0.5, reversible: false }],
  email:          [{ to: "contact", confidence: 0.8, reversible: true }, { to: "person", confidence: 0.5, reversible: false }],
  registered_agent:[{ to: "person", confidence: 0.7, reversible: false }, { to: "business", confidence: 0.6, reversible: false }],
};

const PLACEHOLDER = /^(n\/?a|none|unknown|null|unavailable|test|tbd|\.|0+)$/i;

// Normalize a node's fields into [{ field, value, normalized }], dropping empties/placeholders.
export function extractFields(node = {}, registry = FIELD_JOIN_REGISTRY) {
  const src = node.fields || node.content || node;
  const out = [];
  for (const field of Object.keys(registry)) {
    const raw = src[field];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value || PLACEHOLDER.test(value)) continue;
    out.push({ field, value, normalized: norm(value) });
  }
  return out;
}

/**
 * Propose candidate edges from one node. Each edge carries direction, evidence, confidence,
 * source, freshness, legality, reversibility — and is NOT promoted until evidence validates it.
 * @param {object} node - { id, kind, fields|content, source?, observed_at? }
 * @returns {Array} candidate edges
 */
export function proposeEdges(node = {}, registry = FIELD_JOIN_REGISTRY) {
  const fromId = node.id || null;
  const fromKind = node.kind || null;
  const source = node.source || node.owner_source || null;
  const observedAt = node.observed_at || null;
  const edges = [];
  for (const { field, value, normalized } of extractFields(node, registry)) {
    for (const join of registry[field]) {
      if (join.to === fromKind) continue; // don't propose an edge to our own kind via our own field
      edges.push({
        from_id: fromId,
        from_kind: fromKind,
        via_field: field,
        value,
        match_key: `${join.to}:${field}:${normalized}`, // candidate target identity
        to_kind: join.to,
        direction: join.reversible ? "both" : "from_to",
        reversible: join.reversible,
        confidence: join.confidence,
        status: "candidate",          // candidate -> (evidence) -> confirmed; never auto-confirmed
        evidence: [{ source, field, observed_at: observedAt }],
      });
    }
  }
  return edges.sort((a, b) => b.confidence - a.confidence);
}

// Two candidate edges that point at the same target identity from different nodes are a join
// signal. Group edges by match_key to find where the graph wants to connect.
export function groupByTarget(edges = []) {
  const m = new Map();
  for (const e of edges) {
    if (!m.has(e.match_key)) m.set(e.match_key, []);
    m.get(e.match_key).push(e);
  }
  return [...m.entries()].map(([match_key, group]) => ({
    match_key,
    to_kind: group[0].to_kind,
    via_fields: [...new Set(group.map((g) => g.via_field))],
    from_ids: group.map((g) => g.from_id),
    best_confidence: Math.max(...group.map((g) => g.confidence)),
    edge_count: group.length,
  }));
}
