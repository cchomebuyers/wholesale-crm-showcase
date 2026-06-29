import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPropertyContactRoutePack,
  kgProjectionForPropertyRoutePack,
  propertyNodeForContactRoute,
  routePackToThinga,
} from "./property_contact_route_pack.js";
import { propertyToThinga } from "../crm_thinga.js";

const property = {
  id: 42,
  formatted_address: "123 Main St",
  city: "Chicago",
  state: "IL",
  zip: "60601",
  county: "Cook",
  source: "cook-il-violations",
  source_id: "17-01-100-001",
  owner_name: "ACME Properties LLC",
  owner_mailing: "9 Investor Ln, Oak Brook, IL",
  owner_source: "cook_assessor",
  arv: 180000,
  mao: 117000,
  lead_score: 88,
};

test("propertyNodeForContactRoute extracts ContactRouteEngine fields from substrate facts", () => {
  const thinga = propertyToThinga(property);
  const node = propertyNodeForContactRoute(thinga);

  assert.equal(node.id, "thinga:property-42");
  assert.equal(node.fields.address, "123 Main St");
  assert.equal(node.fields.parcel_id, "17-01-100-001");
  assert.equal(node.fields.owner_name, "ACME Properties LLC");
  assert.equal(node.content.county, "Cook");
});

test("buildPropertyContactRoutePack creates an executable route pack and keeps outreach blocked", () => {
  const thinga = propertyToThinga(property);
  const pack = buildPropertyContactRoutePack(thinga, { hasKeys: { batchdata_api_key: false } });

  assert.equal(pack.kind, "contact_route_pack");
  assert.equal(pack.executable.handler, "resolveContactRoute");
  assert.equal(pack.executable.args.node.fields.owner_name, "ACME Properties LLC");
  assert.equal(pack.contact_route_engine.goal, "phone");
  assert.ok(pack.contact_route_engine.best_path || pack.contact_route_engine.fallback_paths.length);
  assert.equal(pack.outreach_allowed, false);
  assert.equal(pack.contact_route_engine.outreach_allowed, false);
  assert.ok(pack.evidence.field_edges.length > 0);
  assert.ok(pack.evidence.proof_citations.length > 0);
});

test("KG projection includes property, route-pack, candidate edges, and proof citations", () => {
  const thinga = propertyToThinga(property);
  const pack = buildPropertyContactRoutePack(thinga);
  const projection = kgProjectionForPropertyRoutePack(thinga, pack);

  assert.ok(projection.entities.some((e) => e.id === "thinga:property-42"));
  assert.ok(projection.entities.some((e) => e.kind === "route_pack"));
  assert.ok(projection.edges.some((e) => e.edge_type === "has_contact_route_pack"));
  assert.ok(projection.edges.some((e) => e.edge_type === "candidate_owner_name_edge"));
  assert.ok(projection.citations.some((c) => c.source_path.includes("property_signals.js")));
});

test("routePackToThinga makes the pack a child of the property Thinga", () => {
  const thinga = propertyToThinga(property);
  const routePackThinga = routePackToThinga(buildPropertyContactRoutePack(thinga));

  assert.equal(routePackThinga.kind, "route_pack");
  assert.deepEqual(routePackThinga.parents, ["thinga:property-42"]);
  assert.equal(routePackThinga.links[0].kind, "route_pack_for");
  assert.equal(routePackThinga.content.executable.engine, "ContactRouteEngine");
});
