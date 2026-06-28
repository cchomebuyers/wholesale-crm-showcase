import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPropertySource,
  mergeBatch,
  mergePropertyRecords,
  normalizePropertyRecord,
  propertyAddrKey,
  scorePropertyLead,
} from "./property_harvest_core.mjs";

test("propertyAddrKey canonicalizes address/city/state/zip variants", () => {
  assert.equal(
    propertyAddrKey({ address: "123 Main Street", city: "Detroit", state: "MI", zip: "48201" }),
    propertyAddrKey({ formatted_address: "123 MAIN ST, Detroit, MI 48201" }),
  );
});

test("property source selector excludes B2B/public-contact and comps", () => {
  assert.equal(isPropertySource({ id: "x", type: "public-contact", search() {} }), false);
  assert.equal(isPropertySource({ id: "x", type: "comps", search() {} }), false);
  assert.equal(isPropertySource({ id: "x", type: "violations", search() {} }), true);
  assert.equal(isPropertySource({ id: "x", type: "parcels", search() {} }), true);
  assert.equal(isPropertySource({ id: "x", type: "listings", search() {} }), true);
});

test("normalizePropertyRecord emits gated property-first shape", () => {
  const out = normalizePropertyRecord(
    { address: "5 Elm", city: "Detroit", state: "MI", zip: "48235", seller_name: "ABC LLC", motivation: "Vacant building" },
    { id: "detroit-vacant", type: "violations", legal_status: "public_official_api" },
    "2026-06-27T00:00:00.000Z",
  );
  assert.equal(out.outreach_allowed, false);
  assert.equal(out.compliance_status, "unchecked");
  assert.equal(out.owner_name, "ABC LLC");
  assert.equal(out.distress, "vacant");
  assert.equal(out.signals.length, 1);
  assert.ok(out.lead_score >= 60);
});

test("mergePropertyRecords preserves distinct source signals and strongest distress", () => {
  const a = normalizePropertyRecord(
    { address: "5 Elm", city: "Detroit", state: "MI", motivation: "Code violation" },
    { id: "code", type: "violations" },
    "2026-06-27T00:00:00.000Z",
  );
  const b = normalizePropertyRecord(
    { address: "5 Elm Street", city: "Detroit", state: "MI", motivation: "Tax delinquent", owner_name: "Jane Seller" },
    { id: "tax", type: "parcels" },
    "2026-06-28T00:00:00.000Z",
  );
  const merged = mergePropertyRecords(a, b);
  assert.equal(merged.owner_name, "Jane Seller");
  assert.equal(merged.distress, "tax_delinquent");
  assert.equal(merged.signals.length, 2);
});

test("mergeBatch dedupes by canonical property key", () => {
  const rows = [
    normalizePropertyRecord({ address: "123 Main Street", city: "Detroit", state: "MI" }, { id: "a", type: "violations" }),
    normalizePropertyRecord({ formatted_address: "123 MAIN ST, Detroit, MI" }, { id: "b", type: "parcels" }),
  ];
  const merged = mergeBatch(rows);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].signals.length, 2);
});

test("scorePropertyLead ranks severe distress above plain parcel records", () => {
  const tax = scorePropertyLead({ distress: "tax_delinquent", owner_name: "A" }).lead_score;
  const parcel = scorePropertyLead({ distress: "parcel_owner_record" }).lead_score;
  assert.ok(tax > parcel);
});
