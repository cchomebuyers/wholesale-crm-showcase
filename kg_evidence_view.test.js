import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPropertyKgEvidenceView, propertyKgId } from "./kg_evidence_view.js";

test("propertyKgId accepts CRM ids and existing property Thingas", () => {
  assert.equal(propertyKgId(39), "thinga:property-39");
  assert.equal(propertyKgId("39"), "thinga:property-39");
  assert.equal(propertyKgId("thinga:property-39"), "thinga:property-39");
  assert.equal(propertyKgId("bad"), null);
  assert.equal(propertyKgId(0), null);
});

test("buildPropertyKgEvidenceView assembles route packs, candidate edges, and citations", async () => {
  const pool = fakeKgPool();
  const view = await buildPropertyKgEvidenceView(pool, 1, { candidateLimit: 2 });

  assert.equal(view.property.id, "thinga:property-1");
  assert.equal(view.property.content.crm_id, 1);
  assert.equal(view.route_packs.length, 1);
  assert.equal(view.route_packs[0].route.best_path, "owner_address_skiptrace");
  assert.equal(view.route_packs[0].edge.confidence, 1);
  assert.equal(view.candidates.length, 1);
  assert.equal(view.candidates[0].entity.kind, "person");
  assert.equal(view.citations[0].source_path, "proof_stack.js");
  assert.deepEqual(view.counts, {
    outgoing_edges: 2,
    candidate_edges: 1,
    route_pack_edges: 1,
    citations: 1,
  });
  assert.equal(pool.params[0][0], "thinga:property-1");
});

test("buildPropertyKgEvidenceView returns null when the property is not in KG", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await buildPropertyKgEvidenceView(pool, 999), null);
});

test("buildPropertyKgEvidenceView rejects invalid ids before querying", async () => {
  const pool = {
    async query() {
      throw new Error("should not query");
    },
  };
  assert.deepEqual(await buildPropertyKgEvidenceView(pool, "x"), {
    error: "property_id must be a positive integer or thinga:property-<id>",
  });
});

function fakeKgPool() {
  return {
    params: [],
    async query(sql, params = []) {
      this.params.push(params);
      if (sql.includes("WHERE id=$1 AND kind='property'")) {
        return {
          rows: [{
            id: "thinga:property-1",
            kind: "property",
            type: "real_estate_acquisition",
            name: "123 Main",
            content: { crm_id: 1 },
            facets: {},
            shard: null,
            updated_at: new Date("2026-06-29T00:00:00Z"),
          }],
        };
      }
      if (sql.includes("outgoing_edges")) {
        return {
          rows: [{
            outgoing_edges: 2,
            candidate_edges: 1,
            route_pack_edges: 1,
            citations: 1,
          }],
        };
      }
      if (sql.includes("JOIN kg_entities rp")) {
        return {
          rows: [{
            edge_type: "has_contact_route_pack",
            source_id: "packs/property_contact_route_pack.js",
            confidence: "1",
            id: "routepack:thinga-property-1:contact-route",
            kind: "route_pack",
            type: "contact_route_engine",
            name: "Contact route",
            content: {
              best_path: "owner_address_skiptrace",
              outreach_allowed: false,
              property_thinga_id: "thinga:property-1",
            },
            facets: {},
            updated_at: "2026-06-29T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("candidate_%_edge")) {
        return {
          rows: [{
            edge_type: "candidate_owner_name_edge",
            source_id: "cook-assessor",
            confidence: 0.6,
            id: "kg:person-owner",
            kind: "person",
            type: "candidate_identity",
            name: "Owner",
            content: { via_field: "owner_name" },
            facets: {},
            updated_at: "2026-06-29T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("FROM kg_citations")) {
        return {
          rows: [{
            entity_id: "thinga:property-1",
            claim: "proof",
            source_path: "proof_stack.js",
            source_kind: "file",
            line_ref: null,
            created_at: "2026-06-29T00:00:00.000Z",
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}
