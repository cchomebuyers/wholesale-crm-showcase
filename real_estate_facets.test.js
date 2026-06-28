import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REAL_ESTATE_FACET_CONFIG,
  createRealEstateFacetRegistry,
  makeRealEstateFacetedThinga,
  makeRealEstateSystemThinga,
  mergeRealEstateThingas,
  parseRealEstateThinga,
  realEstateIdentityKeys,
  realEstateFacetsFromRecord,
  sameRealEstateProperty,
} from "./real_estate_facets.js";

test("real-estate facet registry registers the whole parser family", () => {
  const reg = createRealEstateFacetRegistry();
  for (const id of [...REAL_ESTATE_FACET_CONFIG.required, ...REAL_ESTATE_FACET_CONFIG.optional]) {
    assert.equal(reg.has(id), true, `${id} parser should be registered`);
  }
});

test("active listing becomes kind realEstate with listing and agent contact facets", () => {
  const t = makeRealEstateFacetedThinga({
    record_type: "listing",
    source_id: "rentcast-sale",
    formatted_address: "5 ELM, Detroit, MI 48235",
    status: "Active",
    price: 75000,
    listing_agent_name: "Ann Agent",
    listing_agent_phone: "(313) 555-0100",
  });

  assert.equal(t.$header.kind, "realEstate");
  assert.equal(t.$header.type, "listing");
  assert.ok(t.$header.$facets.includes("listing"));
  assert.ok(t.$header.$facets.includes("contact"));

  const parsed = parseRealEstateThinga(t, { mode: "strict" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.parsed.listing.sale_status, "active");
  assert.equal(parsed.parsed.contact.phone, "3135550100");
  assert.equal(parsed.parsed.contact.contact_relation, "agent");
  assert.equal(parsed.parsed.inference.contactability, "has_contact");
});

test("violation source separates direct facts from inference", () => {
  const facets = realEstateFacetsFromRecord({
    source: "cook-il-violations",
    address: "123 MAIN ST",
    city: "Chicago",
    state: "IL",
    ordinance: "Vacant building",
    seller_name: "ABC HOLDINGS LLC",
  });

  assert.equal(facets.source.source, "cook-il-violations");
  assert.equal(facets.inference.owner_type, "business");
  assert.equal(facets.inference.contactability, "needs_enrichment");
  assert.ok(facets.inference.notes.some((x) => x.includes("distress")));
});

test("sold records are parsed as comps/fuel, not live leads", () => {
  const t = makeRealEstateFacetedThinga({
    record_type: "comps",
    source_id: "detroit-comps",
    address: "9 SOLD ST",
    status: "Sold",
    sale_price: 100000,
    sale_date: "2026-01-15",
    square_footage: 1100,
  });

  const parsed = parseRealEstateThinga(t, { mode: "strict" });
  assert.equal(parsed.parsed.inference.sale_status, "sold");
  assert.ok(parsed.parsed.inference.notes.some((x) => x.includes("comps")));
  assert.equal(parsed.parsed.valuation.price, 100000);
});

test("system architecture Thinga is recursive and parses with required facets", () => {
  const t = makeRealEstateSystemThinga();
  assert.equal(t.$header.kind, "realEstate");
  assert.equal(t.$header.type, "system");
  assert.ok(t.$header.children.length >= 10);

  const parsed = parseRealEstateThinga(t, { mode: "strict" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.parsed.workflow.stage, "architecture");
  assert.equal(parsed.parsed.inference.confidence, "high");
});

test("identity keys use parcel, canonical address, source row, and geo when present", () => {
  const t = makeRealEstateFacetedThinga({
    source_id: "wayne-mi-parcels",
    source_row_id: "abc",
    address: "123 Main St.",
    city: "Detroit",
    state: "MI",
    zip: "48201-1111",
    parcel_id: "12-34",
    latitude: 42.33145,
    longitude: -83.04575,
  });
  const keys = realEstateIdentityKeys(t);
  assert.ok(keys.includes("parcel:MI:12-34"));
  assert.ok(keys.includes("address:123 MAIN ST|DETROIT|MI|48201"));
  assert.ok(keys.includes("source:wayne-mi-parcels:abc"));
  assert.ok(keys.includes("geo:42.33145,-83.04575"));
});

test("sameRealEstateProperty detects the same property by canonical address", () => {
  const a = makeRealEstateFacetedThinga({ source_id: "a", address: "123 Main St.", city: "Detroit", state: "MI", zip: "48201" });
  const b = makeRealEstateFacetedThinga({ source_id: "b", address: "123 MAIN ST", city: "Detroit", state: "MI", zip: "48201" });
  const same = sameRealEstateProperty(a, b);
  assert.equal(same.same, true);
  assert.ok(same.matches.some((k) => k.startsWith("address:")));
});

test("mergeRealEstateThingas preserves evidence from both source Thingas", () => {
  const violation = makeRealEstateFacetedThinga({
    source_id: "cook-il-violations",
    address: "123 Main St",
    city: "Chicago",
    state: "IL",
    ordinance: "Vacant building",
  });
  const phone = makeRealEstateFacetedThinga({
    source_id: "nyc-business-licenses",
    address: "123 MAIN ST",
    city: "Chicago",
    state: "IL",
    business_name: "ACME LLC",
    phone: "312-555-0100",
  });
  const merged = mergeRealEstateThingas(violation, phone);
  const parsed = parseRealEstateThinga(merged, { mode: "strict" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.parsed.contact.phone, "3125550100");
  assert.equal(parsed.parsed.distress.ordinance, "Vacant building");
  assert.ok(merged.$header.children.includes(violation.$header.id));
  assert.ok(merged.$header.children.includes(phone.$header.id));
});

test("mergeRealEstateThingas rejects unrelated properties by default", () => {
  const a = makeRealEstateFacetedThinga({ source_id: "a", address: "1 A ST", city: "Detroit", state: "MI" });
  const b = makeRealEstateFacetedThinga({ source_id: "b", address: "2 B ST", city: "Detroit", state: "MI" });
  assert.throws(() => mergeRealEstateThingas(a, b), /without a shared/);
});
