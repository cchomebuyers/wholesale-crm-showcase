// parser_registry.test.js -- the engine is config #1, not real-estate-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerKind, getKind, listKinds, fieldJoinsFor, routeFamiliesFor } from "./parser_registry.js";
import { proposeEdges, extractFields } from "./field_edges.js";
import { planRoutes } from "./route_planner.js";

test("route planning works for a NON-real-estate domain via its registered route families", () => {
  const fams = routeFamiliesFor("smb");
  assert.ok(Array.isArray(fams) && fams.length >= 1);
  // an smb with a known business address can plan a legal route to a phone (business-license route)
  const plan = planRoutes({ goal: "phone", known: ["address"], routeFamilies: fams });
  assert.ok(plan.best_path, "smb finds a route to phone");
  assert.equal(plan.best_path.route, "smb_address_license_phone");
  assert.notEqual(plan.best_path.class, "RED");
  assert.equal(plan.best_path.outreach_allowed, false); // planning never authorizes outreach
});

test("default planRoutes (no routeFamilies arg) still uses the real-estate families", () => {
  const plan = planRoutes({ goal: "owner_name", known: ["address"] });
  assert.equal(plan.best_path.route, "address_to_parcel_to_owner"); // backward compatible
});

test("real estate is registered as config #1", () => {
  assert.ok(listKinds().includes("realEstate"));
  assert.equal(getKind("realEstate").schema, "realEstate.v1");
});

test("THE SAME field_edges engine proposes edges for a NON-real-estate kind via config only", () => {
  const smbReg = fieldJoinsFor("smb");
  const node = {
    id: "smb:7", kind: "smb", source: "nyc-business-licenses",
    fields: { business_name: "ACME PLUMBING LLC", phone: "3135550100", website: "acmeplumbing.com", license_id: "PL-12345" },
  };
  // extract uses the smb schema's fields, not real-estate's
  const fields = extractFields(node, smbReg).map((f) => f.field);
  assert.ok(fields.includes("business_name") && fields.includes("website") && fields.includes("license_id"));
  // and the SAME proposeEdges produces candidate edges into the smb domain's target kinds
  const edges = proposeEdges(node, smbReg);
  const toKinds = new Set(edges.map((e) => e.to_kind));
  assert.ok(toKinds.has("domain") && toKinds.has("contact") && toKinds.has("license"));
  assert.ok(edges.every((e) => e.status === "candidate")); // same invariant: never auto-confirmed
});

test("registering a brand-new kind needs no engine change", () => {
  registerKind("vehicle", { fieldJoins: { vin: [{ to: "vehicle", confidence: 0.99, reversible: true }], plate: [{ to: "registration", confidence: 0.9, reversible: true }] } });
  const reg = fieldJoinsFor("vehicle");
  const edges = proposeEdges({ id: "v1", kind: "title", fields: { vin: "1HGCM82633A004352", plate: "ABC123" } }, reg);
  assert.equal(edges.length, 2);
  assert.ok(edges.find((e) => e.to_kind === "vehicle" && e.via_field === "vin"));
});

test("default (no registry arg) still uses the built-in real-estate registry", () => {
  const edges = proposeEdges({ id: "p1", kind: "property", fields: { address: "1 Main St", owner_name: "X" } });
  assert.ok(edges.length > 0); // backward compatible
});
