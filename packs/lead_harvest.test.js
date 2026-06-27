// packs/lead_harvest.test.js — the chained harvest workflow runs through the kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHarvestEngine } from "./lead_harvest.js";

// stub connector with a paginated harvest() (no network); 50 rows/page, some duplicate phones.
const stubRegistry = {
  "stub-src": {
    id: "stub-src", type: "public-contact",
    async harvest({ limit = 1000, offset = 0 } = {}) {
      if (offset >= 120) return [];
      return Array.from({ length: Math.min(limit, 50) }, (_, i) => {
        const n = offset + i;
        return { license_id: "L" + n, business_name: "BIZ " + n, phone: "31355501" + String(n).padStart(2, "0"),
          address: n + " MAIN ST", city: "DETROIT", state: "MI", zip: "48201", source_id: "stub-src" };
      });
    },
  },
};

test("harvest_leads is a 3-step chain (harvest → dedupe → gate)", () => {
  const e = buildHarvestEngine({ registry: stubRegistry });
  assert.ok(e.routes.has("harvest_leads"));
  for (const c of ["harvest_contacts", "dedupe_leads", "compliance_gate"]) assert.ok(e.capabilities.has(c));
});

test("each step's output feeds the next; produces gated leads with phones", async () => {
  const e = buildHarvestEngine({ registry: stubRegistry });
  const r = await e.runRoute("harvest_leads", { sourceId: "stub-src", count: 100, pageSize: 50 });
  // step 1 → harvested, step 2 reads harvested, step 3 reads deduped
  assert.ok(r.vars.harvested.raw_count >= 100);
  assert.equal(r.vars.deduped.count, r.result.leads.length);
  assert.equal(r.result.gated, true);
  assert.ok(r.result.leads.length >= 100);
  assert.ok(r.result.leads.every((l) => l.phone && l.outreach_allowed === false));
  assert.equal(r.evidence.length, 3);
});

test("missing source errors on the required first step", async () => {
  const e = buildHarvestEngine({ registry: {} });
  const r = await e.runRoute("harvest_leads", { sourceId: "nope", count: 10 });
  assert.equal(r.evidence[0].status, "error");
});
