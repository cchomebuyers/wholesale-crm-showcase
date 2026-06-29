import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRealEstateIdentityGraphEngine,
  extractJoinableFields,
  proposeIdentityEdges,
} from "./real_estate_identity_graph.js";
import { toRealEstateThinga } from "../real_estate_thinga.js";

const sample = {
  source_id: "cook-il-violations",
  address: "123 Main St, Chicago, IL",
  parcel_id: "17-01-100-001",
  owner_name: "ACME Properties LLC",
  owner_mailing_address: "9 Investor Ln, Oak Brook, IL",
  phone: "(312) 555-0100",
  email: "ops@acme.test",
};

test("extractJoinableFields declares what every field can legally become next", () => {
  const fields = extractJoinableFields(sample);
  const address = fields.find((f) => f.name === "address");
  const owner = fields.find((f) => f.name === "owner_name");
  const phone = fields.find((f) => f.name === "phone");

  assert.ok(address.possible_node_types.includes("business"));
  assert.ok(address.possible_node_types.includes("parcel"));
  assert.ok(owner.possible_node_types.includes("business"));
  assert.ok(owner.possible_sources.includes("secretary_of_state"));
  assert.ok(phone.permission_rules.some((r) => /DNC/.test(r)));
  assert.equal(phone.normalized_value, "3125550100");
});

test("proposeIdentityEdges creates directional evidence-backed candidate links", () => {
  const graph = proposeIdentityEdges(sample);
  const businessAtAddress = graph.edges.find((e) => e.relation === "business_may_operate_at_address");
  const ownerBusiness = graph.edges.find((e) => e.relation === "business_owner_candidate");
  const parcel = graph.edges.find((e) => e.relation === "has_parcel_id");

  assert.equal(graph.node.kind, "realEstate");
  assert.ok(businessAtAddress, "property address can expose a business candidate");
  assert.equal(businessAtAddress.reversibility, "single_link_candidate");
  assert.equal(ownerBusiness.to.kind, "business");
  assert.equal(parcel.reversibility, "double_link_candidate");
  for (const edge of graph.edges) {
    assert.ok(edge.direction);
    assert.ok(edge.evidence.length);
    assert.ok(Number.isFinite(edge.confidence));
    assert.ok(edge.source);
    assert.ok(edge.freshness);
    assert.ok(edge.legality);
  }
});

test("route pack runs a realEstate Thinga through the route kernel", async () => {
  const engine = buildRealEstateIdentityGraphEngine();
  const thinga = toRealEstateThinga(sample);
  const result = await engine.runRoute("real_estate_fields_to_edges", thinga);

  assert.equal(result.goal, "identity_edges");
  assert.ok(result.vars.fields.some((f) => f.name === "owner_name"));
  assert.ok(result.result.edges.some((e) => e.relation === "owner_candidate"));
  assert.equal(result.evidence.length, 2);
  assert.ok(engine.plan("identity_edges").find((r) => r.route === "real_estate_fields_to_edges" && r.runnable));
});
