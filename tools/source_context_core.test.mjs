import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceContext, enrichPropertyContext, inferStateFromSourceId } from "./source_context_core.mjs";

test("inferStateFromSourceId extracts two-letter state token", () => {
  assert.equal(inferStateFromSourceId("cook-il-violations"), "IL");
  assert.equal(inferStateFromSourceId("santaclara-ca-parcels"), "CA");
});

test("enrichPropertyContext fills state and county from source registry", () => {
  const ctx = buildSourceContext([
    { source_id: "cook-il-violations", state: "IL", county: "Cook County", county_fips: "17031" },
  ]);
  const out = enrichPropertyContext({ source: "cook-il-violations", address: "10 Main" }, ctx);
  assert.equal(out.state, "IL");
  assert.equal(out.county, "Cook County");
  assert.equal(out.county_fips, "17031");
  assert.equal(out.context_enrichment.filled_state, true);
});

test("enrichPropertyContext keeps existing row values", () => {
  const ctx = buildSourceContext([
    { source_id: "x-ca-parcels", state: "CA", county: "Registry County" },
  ]);
  const out = enrichPropertyContext({ source: "x-ca-parcels", state: "NV", county: "Existing County" }, ctx);
  assert.equal(out.state, "NV");
  assert.equal(out.county, "Existing County");
  assert.equal(out.context_enrichment.filled_county, false);
});
