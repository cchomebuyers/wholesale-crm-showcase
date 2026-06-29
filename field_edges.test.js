// field_edges.test.js -- nodes store facts, fields propose edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFields, proposeEdges, groupByTarget, FIELD_JOIN_REGISTRY } from "./field_edges.js";

test("extractFields keeps real joinable fields, drops empties/placeholders", () => {
  const f = extractFields({ address: "1429 N Springfield Ave", owner_name: "MIGUEL FLORES", phone: "", parcel_id: "N/A" });
  const fields = f.map((x) => x.field);
  assert.ok(fields.includes("address") && fields.includes("owner_name"));
  assert.ok(!fields.includes("phone") && !fields.includes("parcel_id")); // empty + placeholder dropped
});

test("a property node proposes edges to owner/business/contact via its fields", () => {
  const edges = proposeEdges({ id: "property:6", kind: "property", source: "cook-il-parcel-addresses",
    fields: { address: "1429 N Springfield Ave", owner_name: "MAPLE COURT LLC", parcel_id: "20023180110000" } });
  // does not propose an edge to its own kind via address->property
  assert.ok(!edges.some((e) => e.via_field === "address" && e.to_kind === "property"));
  // proposes owner_name -> business/person
  assert.ok(edges.some((e) => e.via_field === "owner_name" && (e.to_kind === "business" || e.to_kind === "person")));
  // every edge is a candidate carrying provenance, never auto-confirmed
  assert.ok(edges.every((e) => e.status === "candidate" && e.evidence.length >= 1));
});

test("candidate edges are sorted by confidence; reversible flagged as double-link", () => {
  const edges = proposeEdges({ id: "p1", kind: "lead", fields: { parcel_id: "123", phone: "3135550100" } });
  assert.ok(edges[0].confidence >= edges[edges.length - 1].confidence);
  const parcel = edges.find((e) => e.via_field === "parcel_id");
  assert.equal(parcel.reversible, true);
  assert.equal(parcel.direction, "both");
});

test("groupByTarget finds where multiple nodes point at the same identity", () => {
  const a = proposeEdges({ id: "property:1", kind: "property", fields: { phone: "3135550100" } });
  const b = proposeEdges({ id: "permit:9", kind: "permit", fields: { phone: "3135550100" } });
  const groups = groupByTarget([...a, ...b]);
  const contactGroup = groups.find((g) => g.to_kind === "contact");
  assert.ok(contactGroup.from_ids.includes("property:1") && contactGroup.from_ids.includes("permit:9"));
  assert.ok(contactGroup.edge_count >= 2);
});

test("FIELD_JOIN_REGISTRY is data-driven (a new domain is config, not code)", () => {
  assert.ok(Object.keys(FIELD_JOIN_REGISTRY).length >= 6);
  for (const joins of Object.values(FIELD_JOIN_REGISTRY)) {
    assert.ok(Array.isArray(joins) && joins.every((j) => j.to && typeof j.confidence === "number"));
  }
});
