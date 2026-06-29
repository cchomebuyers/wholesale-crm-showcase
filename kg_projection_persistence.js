// kg_projection_persistence.js -- persist route-pack KG projections into wholesale_kg.
//
// This is deliberately pgvector-free. It writes only the relational tables from
// knowledge-graph/schema.sql: kg_entities, kg_edges, and kg_citations.

import pg from "pg";

export const DEFAULT_KG_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/wholesale_kg";

export function kgConnectionString(env = process.env) {
  if (env.KG_DATABASE_URL) return env.KG_DATABASE_URL;
  if (env.WHOLESALE_KG_DATABASE_URL) return env.WHOLESALE_KG_DATABASE_URL;
  if (env.DATABASE_URL && /\/wholesale_kg(?:\?|$)/.test(env.DATABASE_URL)) return env.DATABASE_URL;
  return DEFAULT_KG_DATABASE_URL;
}

export function createKgPool(connectionString = kgConnectionString()) {
  return new pg.Pool({ connectionString, max: 5 });
}

export async function ensureKgSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kg_entities (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      type        TEXT,
      name        TEXT,
      content     JSONB,
      facets      JSONB,
      shard       INTEGER,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kg_entities_kind ON kg_entities (kind);
    CREATE INDEX IF NOT EXISTS idx_kg_entities_content ON kg_entities USING GIN (content jsonb_path_ops);

    CREATE TABLE IF NOT EXISTS kg_edges (
      from_id     TEXT NOT NULL,
      edge_type   TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      source_id   TEXT,
      confidence  REAL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kg_edges_to   ON kg_edges (to_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges (from_id, edge_type);

    CREATE TABLE IF NOT EXISTS kg_citations (
      id          BIGSERIAL PRIMARY KEY,
      entity_id   TEXT,
      claim       TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_kind TEXT DEFAULT 'file',
      line_ref    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kg_citations_entity ON kg_citations (entity_id);
  `);
}

export function kgProjectionFromRoutePackThinga(thinga = {}) {
  const projection = thinga.content?.kg_projection;
  if (!projection) return null;
  return normalizeProjection(projection);
}

export function normalizeProjection(projection = {}) {
  return {
    entities: Array.isArray(projection.entities) ? projection.entities.filter((e) => e?.id && e?.kind) : [],
    edges: Array.isArray(projection.edges) ? projection.edges.filter((e) => e?.from_id && e?.edge_type && e?.to_id) : [],
    citations: Array.isArray(projection.citations) ? projection.citations.filter((c) => c?.claim && c?.source_path) : [],
  };
}

export async function persistKgProjection(pool, projection, opts = {}) {
  const normalized = normalizeProjection(projection);
  if (opts.ensureSchema !== false) await ensureKgSchema(pool);

  for (const entity of normalized.entities) {
    await pool.query(
      `INSERT INTO kg_entities (id, kind, type, name, content, facets, shard, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (id) DO UPDATE SET
         kind=EXCLUDED.kind,
         type=EXCLUDED.type,
         name=EXCLUDED.name,
         content=EXCLUDED.content,
         facets=EXCLUDED.facets,
         shard=EXCLUDED.shard,
         updated_at=now()`,
      [
        entity.id,
        entity.kind,
        entity.type ?? null,
        entity.name ?? null,
        JSON.stringify(entity.content ?? {}),
        JSON.stringify(entity.facets ?? {}),
        Number.isInteger(entity.shard) ? entity.shard : null,
      ],
    );
  }

  for (const edge of normalized.edges) {
    await pool.query(
      `DELETE FROM kg_edges
       WHERE from_id=$1 AND edge_type=$2 AND to_id=$3 AND COALESCE(source_id,'')=COALESCE($4,'')`,
      [edge.from_id, edge.edge_type, edge.to_id, edge.source_id ?? null],
    );
    await pool.query(
      `INSERT INTO kg_edges (from_id, edge_type, to_id, source_id, confidence)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        edge.from_id,
        edge.edge_type,
        edge.to_id,
        edge.source_id ?? null,
        Number.isFinite(Number(edge.confidence)) ? Number(edge.confidence) : null,
      ],
    );
  }

  const citationEntityIds = [...new Set(normalized.citations.map((c) => c.entity_id).filter(Boolean))];
  for (const entityId of citationEntityIds) {
    await pool.query("DELETE FROM kg_citations WHERE entity_id=$1", [entityId]);
  }
  for (const citation of normalized.citations) {
    await pool.query(
      `INSERT INTO kg_citations (entity_id, claim, source_path, source_kind, line_ref)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        citation.entity_id ?? null,
        citation.claim,
        citation.source_path,
        citation.source_kind || "file",
        citation.line_ref ?? null,
      ],
    );
  }

  return {
    entities: normalized.entities.length,
    edges: normalized.edges.length,
    citations: normalized.citations.length,
  };
}

export async function kgCounts(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM kg_entities) AS entities,
      (SELECT COUNT(*)::int FROM kg_edges) AS edges,
      (SELECT COUNT(*)::int FROM kg_citations) AS citations,
      (SELECT COUNT(*)::int FROM kg_entities WHERE kind='property') AS property_entities,
      (SELECT COUNT(*)::int FROM kg_entities WHERE kind='route_pack') AS route_pack_entities
  `);
  return result.rows[0];
}

export async function propertyRouteKgReport(pool, limit = 5) {
  const counts = await kgCounts(pool);
  const sample = await pool.query(
    `SELECT
       p.id AS property_id,
       p.name AS property_name,
       rp.id AS route_pack_id,
       rp.content->>'best_path' AS best_path,
       candidate.id AS candidate_id,
       candidate.kind AS candidate_kind,
       candidate.name AS candidate_name,
       c.source_path AS citation_source,
       c.claim AS citation_claim
     FROM kg_entities p
     JOIN kg_edges link
       ON link.from_id=p.id AND link.edge_type='has_contact_route_pack'
     JOIN kg_entities rp
       ON rp.id=link.to_id AND rp.kind='route_pack'
     LEFT JOIN kg_edges ce
       ON ce.from_id=p.id AND ce.edge_type LIKE 'candidate_%_edge'
     LEFT JOIN kg_entities candidate
       ON candidate.id=ce.to_id
     LEFT JOIN kg_citations c
       ON c.entity_id=p.id
     WHERE p.kind='property'
     ORDER BY p.id
     LIMIT $1`,
    [Math.max(1, Math.min(100, Number(limit) || 5))],
  );
  return { counts, sample: sample.rows };
}
