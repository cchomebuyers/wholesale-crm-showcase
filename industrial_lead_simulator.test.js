import { test } from "node:test";
import assert from "node:assert/strict";
import { INDUSTRIAL_FAILURES, simulateIndustrialLead, summarizeSimulation } from "./industrial_lead_simulator.js";
import { parseRealEstateThinga } from "./real_estate_facets.js";

test("simulation catches duplicate industrial property records and produces a merged parent", () => {
  const sim = simulateIndustrialLead([
    {
      source_id: "county-violations",
      address: "123 Industrial Street",
      city: "Detroit",
      state: "MI",
      ordinance: "Unsafe structure",
      seller_name: "ABC HOLDINGS LLC",
    },
    {
      source_id: "epa-envirofacts-frs",
      address: "123 INDUSTRIAL ST",
      city: "Detroit",
      state: "MI",
      facility_name: "ABC METAL WORKS",
    },
  ]);

  assert.equal(sim.merges.length, 1);
  assert.ok(sim.failures.some((f) => f.type === INDUSTRIAL_FAILURES.DUPLICATE_PROPERTY));
  const parsed = parseRealEstateThinga(sim.merges[0].merged, { mode: "strict" }).parsed;
  assert.equal(parsed.property.addr_key, "123 INDUSTRIAL ST");
  assert.equal(parsed.distress.ordinance, "Unsafe structure");
});

test("simulation flags public business/operator phone as not proven owner phone", () => {
  const sim = simulateIndustrialLead([
    {
      source_id: "nyc-business-licenses",
      address: "50 Warehouse Ave",
      city: "New York",
      state: "NY",
      business_name: "TENANT LOGISTICS LLC",
      phone: "212-555-0100",
    },
  ]);

  assert.ok(sim.failures.some((f) => f.type === INDUSTRIAL_FAILURES.CONTACT_NOT_OWNER));
  assert.ok(sim.failures.some((f) => f.type === INDUSTRIAL_FAILURES.NO_OWNER));
});

test("simulation blocks outreach until compliance facet explicitly clears it", () => {
  const sim = simulateIndustrialLead([
    {
      source_id: "rentcast-sale",
      record_type: "listing",
      address: "9 Dock Rd",
      city: "Cleveland",
      state: "OH",
      status: "Active",
      listing_agent_phone: "2165550100",
    },
  ]);

  const summary = summarizeSimulation(sim);
  assert.equal(summary.counts[INDUSTRIAL_FAILURES.COMPLIANCE_BLOCK], 1);
  assert.ok(summary.top_fixes.some((x) => x.includes("DNC")));
});

