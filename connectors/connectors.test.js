// connectors/connectors.test.js — gate the connector registry + RESO scaffold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry } from "./index.js";
import { normalizeRentcast } from "./rentcast.js";
import { buildResoFilter, normalizeReso, RESO_FIELD } from "./reso.js";
import { normalizeBlight } from "./detroit.js";

// minimal deps stub
const deps = (over = {}) => ({
  rentcastGet: async () => [],
  pullBlightTickets: async () => [],
  detroitComps: async () => null,
  getSetting: () => null,
  ...over,
});

test("registry exposes the core connectors (+ data-driven counties), each with the search interface", () => {
  const r = buildRegistry(deps());
  for (const id of ["census-geocode", "detroit-blight", "detroit-comps", "rentcast-sale", "reso-mls"]) {
    assert.ok(r[id], `missing core connector ${id}`);
  }
  for (const c of Object.values(r)) {
    assert.equal(typeof c.search, "function");
    assert.ok(c.id && c.region && c.type);
  }
});

test("canonicalAddr normalizes suffixes/directionals so variants dedupe to one key", async () => {
  const { canonicalAddr } = await import("./census.js");
  assert.equal(canonicalAddr("123 Main St"), canonicalAddr("123 MAIN STREET"));
  assert.equal(canonicalAddr("45 North Oak Ave."), "45 N OAK AVE");
});

test("rentcast connector normalizes listings to the property shape", async () => {
  const r = buildRegistry(deps({
    rentcastGet: async () => [{ formattedAddress: "5 ELM, Detroit, MI 48235", addressLine1: "5 ELM", city: "Detroit", state: "MI", zipCode: "48235", price: 50000, bedrooms: 3, propertyType: "Single Family", listingAgent: { name: "Ann", phone: "313" } }],
  }));
  const out = await r["rentcast-sale"].search({ city: "Detroit" });
  assert.equal(out.length, 1);
  assert.equal(out[0].addr_key, "5 elm, detroit, mi 48235");
  assert.equal(out[0].source, "rentcast");
  assert.equal(out[0].listing_agent_name, "Ann");
});

test("normalizeRentcast drops a listing with no derivable address", () => {
  assert.equal(normalizeRentcast({ price: 1 }), null);
});

test("RESO filter always pins StandardStatus eq 'Active' (the never-sold guarantee)", () => {
  const f = buildResoFilter({ city: "Detroit", price_max: 60000, beds_min: 3 });
  assert.match(f, /StandardStatus eq 'Active'/);
  assert.match(f, /City eq 'Detroit'/);
  assert.match(f, /ListPrice le 60000/);
  assert.match(f, /BedroomsTotal ge 3/);
  assert.doesNotMatch(f, /Sold|Closed/);
});

test("RESO filter escapes quotes in city (injection-safe)", () => {
  assert.match(buildResoFilter({ city: "O'Fallon" }), /City eq 'O''Fallon'/);
});

test("normalizeReso maps StandardName fields and requires an address", () => {
  const o = normalizeReso({ UnparsedAddress: "9 OAK", ListPrice: 75000, StandardStatus: "Active", BedroomsTotal: 4 });
  assert.equal(o.formatted_address, "9 OAK");
  assert.equal(o.price, 75000);
  assert.equal(o.bedrooms, 4);
  assert.equal(o.addr_key, "9 oak");
  assert.equal(normalizeReso({ ListPrice: 1 }), null);
});

test("RESO connector returns [] without a token (scaffolded, never throws)", async () => {
  const r = buildRegistry(deps()); // getSetting → null
  assert.deepEqual(await r["reso-mls"].search({ city: "Detroit" }), []);
});

test("detroit blight connector normalizes tickets, flags absentee owners", async () => {
  const r = buildRegistry(deps({
    pullBlightTickets: async () => [{ address: "100 MAIN", zip_code: "48201", property_owner_name: "LLC X", property_owner_address: "999 ELSEWHERE", ordinance_description: "blight" }],
  }));
  const out = await r["detroit-blight"].search({ days: 30 });
  assert.equal(out[0].source, "detroit-blight");
  assert.equal(out[0].motivation, "Code violation");
  assert.equal(out[0].absentee, true);
});

test("RESO_FIELD includes the status field used for the active-only guarantee", () => {
  assert.equal(RESO_FIELD.StandardStatus, "status");
});
