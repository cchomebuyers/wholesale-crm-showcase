// kg_evidence_view.js -- read-only property KG evidence view for API routes.

export function propertyKgId(value) {
  if (typeof value === "string" && /^thinga:property-\d+$/.test(value)) return value;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return `thinga:property-${id}`;
}

export async function buildPropertyKgEvidenceView(pool, propertyId, opts = {}) {
  const kgId = propertyKgId(propertyId);
  if (!kgId) return { error: "property_id must be a positive integer or thinga:property-<id>" };

  const routePackLimit = boundedLimit(opts.routePackLimit, 10);
  const candidateLimit = boundedLimit(opts.candidateLimit, 50);
  const citationLimit = boundedLimit(opts.citationLimit, 50);

  const property = await one(pool, `
    SELECT id, kind, type, name, content, facets, shard, updated_at
    FROM kg_entities
    WHERE id=$1 AND kind='property'
  `, [kgId]);
  if (!property) return null;

  const routePacks = await rows(pool, `
    SELECT
      link.edge_type,
      link.source_id,
      link.confidence,
      rp.id,
      rp.kind,
      rp.type,
      rp.name,
      rp.content,
      rp.facets,
      rp.updated_at
    FROM kg_edges link
    JOIN kg_entities rp ON rp.id=link.to_id AND rp.kind='route_pack'
    WHERE link.from_id=$1 AND link.edge_type='has_contact_route_pack'
    ORDER BY link.confidence DESC NULLS LAST, rp.id
    LIMIT $2
  `, [kgId, routePackLimit]);

  const candidates = await rows(pool, `
    SELECT
      e.edge_type,
      e.source_id,
      e.confidence,
      target.id,
      target.kind,
      target.type,
      target.name,
      target.content,
      target.facets,
      target.updated_at
    FROM kg_edges e
    LEFT JOIN kg_entities target ON target.id=e.to_id
    WHERE e.from_id=$1 AND e.edge_type LIKE 'candidate_%_edge'
    ORDER BY e.confidence DESC NULLS LAST, e.edge_type, target.id
    LIMIT $2
  `, [kgId, candidateLimit]);

  const citations = await rows(pool, `
    SELECT entity_id, claim, source_path, source_kind, line_ref, created_at
    FROM kg_citations
    WHERE entity_id=$1
    ORDER BY id
    LIMIT $2
  `, [kgId, citationLimit]);

  const counts = await one(pool, `
    SELECT
      (SELECT COUNT(*)::int FROM kg_edges WHERE from_id=$1) AS outgoing_edges,
      (SELECT COUNT(*)::int FROM kg_edges WHERE from_id=$1 AND edge_type LIKE 'candidate_%_edge') AS candidate_edges,
      (SELECT COUNT(*)::int FROM kg_edges WHERE from_id=$1 AND edge_type='has_contact_route_pack') AS route_pack_edges,
      (SELECT COUNT(*)::int FROM kg_citations WHERE entity_id=$1) AS citations
  `, [kgId]);

  return {
    property: normalizeEntity(property),
    route_packs: routePacks.map((r) => ({
      edge: normalizeEdge(r),
      entity: normalizeEntity(r),
      route: normalizeRoutePackContent(r.content),
    })),
    candidates: candidates.map((r) => ({
      edge: normalizeEdge(r),
      entity: normalizeEntity(r),
    })),
    citations: citations.map(normalizeCitation),
    counts,
  };
}

function boundedLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

async function one(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function rows(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result.rows || [];
}

function normalizeEntity(row = {}) {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type ?? null,
    name: row.name ?? null,
    content: row.content || {},
    facets: row.facets || {},
    shard: row.shard ?? null,
    updated_at: iso(row.updated_at),
  };
}

function normalizeEdge(row = {}) {
  return {
    type: row.edge_type,
    source_id: row.source_id ?? null,
    confidence: row.confidence == null ? null : Number(row.confidence),
  };
}

function normalizeCitation(row = {}) {
  return {
    entity_id: row.entity_id ?? null,
    claim: row.claim,
    source_path: row.source_path,
    source_kind: row.source_kind || "file",
    line_ref: row.line_ref ?? null,
    created_at: iso(row.created_at),
  };
}

function normalizeRoutePackContent(content = {}) {
  return {
    best_path: content.best_path ?? null,
    outreach_allowed: content.outreach_allowed ?? null,
    property_thinga_id: content.property_thinga_id ?? null,
  };
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
