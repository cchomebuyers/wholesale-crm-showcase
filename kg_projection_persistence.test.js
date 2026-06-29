import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kgConnectionString,
  kgProjectionFromRoutePackThinga,
  normalizeProjection,
  persistKgProjection,
} from "./kg_projection_persistence.js";

test("kgConnectionString prefers explicit KG database URLs over generic DATABASE_URL", () => {
  assert.equal(
    kgConnectionString({
      KG_DATABASE_URL: "postgresql://example/kg",
      DATABASE_URL: "postgresql://example/app",
    }),
    "postgresql://example/kg",
  );
  assert.equal(
    kgConnectionString({ DATABASE_URL: "postgresql://example/wholesale_kg" }),
    "postgresql://example/wholesale_kg",
  );
  assert.match(kgConnectionString({ DATABASE_URL: "postgresql://example/wholesale_crm" }), /wholesale_kg$/);
});

test("kgProjectionFromRoutePackThinga extracts and normalizes embedded projections", () => {
  const projection = kgProjectionFromRoutePackThinga({
    kind: "route_pack",
    content: {
      kg_projection: {
        entities: [
          { id: "thinga:property-1", kind: "property" },
          { id: "", kind: "bad" },
        ],
        edges: [
          { from_id: "thinga:property-1", edge_type: "has_contact_route_pack", to_id: "routepack:1" },
          { from_id: "thinga:property-1" },
        ],
        citations: [
          { entity_id: "thinga:property-1", claim: "proof", source_path: "proof_stack.js" },
          { claim: "missing source" },
        ],
      },
    },
  });

  assert.equal(projection.entities.length, 1);
  assert.equal(projection.edges.length, 1);
  assert.equal(projection.citations.length, 1);
});

test("normalizeProjection tolerates missing arrays", () => {
  assert.deepEqual(normalizeProjection({}), { entities: [], edges: [], citations: [] });
});

test("persistKgProjection upserts entities and refreshes matching edges and citations", async () => {
  const pool = fakePool();
  const result = await persistKgProjection(pool, {
    entities: [
      {
        id: "thinga:property-1",
        kind: "property",
        type: "real_estate_acquisition",
        name: "123 Main",
        content: { crm_id: 1 },
      },
    ],
    edges: [
      {
        from_id: "thinga:property-1",
        edge_type: "has_contact_route_pack",
        to_id: "routepack:1",
        source_id: "packs/property_contact_route_pack.js",
        confidence: 1,
      },
    ],
    citations: [
      {
        entity_id: "thinga:property-1",
        claim: "property proof citation",
        source_path: "proof_stack.js",
        source_kind: "file",
      },
    ],
  }, { ensureSchema: false });

  assert.deepEqual(result, { entities: 1, edges: 1, citations: 1 });
  assert.ok(pool.sql.some((s) => s.includes("ON CONFLICT (id) DO UPDATE")));
  assert.ok(pool.sql.some((s) => s.includes("DELETE FROM kg_edges")));
  assert.ok(pool.sql.some((s) => s.includes("DELETE FROM kg_citations WHERE entity_id=$1")));
  assert.equal(pool.params.at(-1)[2], "proof_stack.js");
});

function fakePool() {
  return {
    sql: [],
    params: [],
    async query(sql, params = []) {
      this.sql.push(sql);
      this.params.push(params);
      return { rows: [] };
    },
  };
}
