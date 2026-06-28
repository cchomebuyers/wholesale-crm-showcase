import { test } from "node:test";
import assert from "node:assert/strict";
import { runAutonomousLeadCycle } from "./autonomous_lead_engine.js";
import { createThingaStore } from "./thinga.js";

test("autonomous lead cycle converges duplicate source records and ranks buyer demand", async () => {
  const registry = {
    violations: {
      id: "test-violations",
      type: "violations",
      async search() {
        return [{
          source_id: "test-violations",
          source_type: "violations",
          address: "123 Industrial Street",
          city: "Detroit",
          state: "MI",
          zip: "48235",
          seller_name: "ABC Holdings LLC",
          ordinance: "Vacant building",
          distress: "Vacant building",
          legal_status: "public_official_api",
        }];
      },
    },
    listings: {
      id: "test-listings",
      type: "listings",
      async search() {
        return [{
          source_id: "test-listings",
          source_type: "listings",
          address: "123 INDUSTRIAL ST",
          city: "Detroit",
          state: "MI",
          zip: "48235",
          status: "Active",
          price: 85000,
          days_on_market: 44,
          listing_agent_phone: "3135550100",
          property_type: "Single Family",
        }];
      },
    },
  };

  const out = await runAutonomousLeadCycle({
    registry,
    target: { city: "Detroit", state: "MI" },
    buyers: [{
      id: 7,
      name: "Detroit Buyer",
      phone: "3135559999",
      areas: "Detroit;48235",
      property_types: "Single Family",
      max_price: 120000,
      cash: 1,
    }],
  });

  assert.equal(out.raw_records, 2);
  assert.equal(out.raw_thingas, 2);
  assert.equal(out.converged_properties, 1);
  assert.equal(out.shortlist.length, 1);
  assert.ok(out.shortlist[0].score >= 75);
  assert.equal(out.shortlist[0].buyer_matches[0].buyer_id, 7);
  assert.ok(out.shortlist[0].confidence.property >= 40);
  assert.ok(out.shortlist[0].confidence.contact < 90);
  assert.equal(out.shortlist[0].spend_allowed, true);
  assert.equal(out.shortlist[0].spread_status, "works");
  assert.ok(out.shortlist[0].projected_spread > 0);
  assert.ok(out.shortlist[0].reasons.some((r) => r.includes("not proven owner")));
});

test("autonomous lead cycle marks spread works only when buyer price beats seller price", async () => {
  const out = await runAutonomousLeadCycle({
    registry: {
      deal: {
        id: "spread-deal",
        type: "violations",
        async search() {
          return [{
            source_id: "spread-deal",
            source_type: "violations",
            legal_status: "public_official_api",
            address: "22 Assignment Ave",
            city: "Detroit",
            state: "MI",
            arv: 180000,
            repair_estimate: 25000,
            seller_acceptable_price: 85000,
            ordinance: "Vacant",
            owner_name: "Deal Seller LLC",
          }];
        },
      },
    },
    target: { city: "Detroit", state: "MI" },
    buyers: [{ id: 4, name: "Cash Buyer", areas: "Detroit", property_types: "Single Family", max_price: 120000, phone: "313", cash: 1 }],
  });
  assert.equal(out.shortlist[0].spread_status, "works");
  assert.equal(out.shortlist[0].projected_spread, 26200);
  assert.equal(out.shortlist[0].spread.anchorSpread, 16000);
});

test("owner contact already present blocks wasteful paid skiptrace", async () => {
  const out = await runAutonomousLeadCycle({
    registry: {
      lead: {
        id: "owner-direct",
        type: "violations",
        async search() {
          return [{
            source_id: "owner-direct",
            source_type: "violations",
            legal_status: "public_official_api",
            address: "500 Owner Phone Ave",
            city: "Detroit",
            state: "MI",
            owner_name: "Jane Seller",
            seller_phone: "3135554444",
            contact_relation: "owner",
            ordinance: "Vacant building",
          }];
        },
      },
    },
    target: { city: "Detroit", state: "MI" },
    buyers: [{
      id: 9,
      name: "Any Detroit Buyer",
      areas: "Detroit",
      max_price: 200000,
      cash: 1,
    }],
  });

  assert.equal(out.shortlist.length, 1);
  assert.ok(out.shortlist[0].confidence.contact >= 90);
  assert.equal(out.shortlist[0].spend_allowed, false);
  assert.ok(out.shortlist[0].spend_blocks.some((b) => b.includes("owner contact already exists")));
});

test("autonomous lead cycle accepts a search plan instead of hardcoded source order", async () => {
  const out = await runAutonomousLeadCycle({
    registry: {
      skip: {
        id: "skip-me",
        type: "listings",
        async search() {
          throw new Error("should not run");
        },
      },
      chosen: {
        id: "chosen-violations",
        type: "violations",
        async search() {
          return [{
            source_id: "chosen-violations",
            source_type: "violations",
            legal_status: "public_official_api",
            address: "700 Plan Driven Rd",
            city: "Detroit",
            state: "MI",
            ordinance: "Vacant",
          }];
        },
      },
    },
    target: { city: "Detroit", state: "MI" },
    searchPlan: { includeSourceTypes: ["violations"] },
    sourceLimit: null,
  });

  assert.deepEqual(out.search_plan.selected_connector_ids, ["chosen-violations"]);
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].source_id, "chosen-violations");
});

test("stored realEstate Thingas are children of the active plan Thinga", async () => {
  const store = createThingaStore(":memory:");
  await runAutonomousLeadCycle({
    registry: {
      src: {
        id: "plan-child-src",
        type: "violations",
        async search() {
          return [{
            source_id: "plan-child-src",
            source_type: "violations",
            legal_status: "public_official_api",
            address: "900 Parent Plan Rd",
            city: "Detroit",
            state: "MI",
            status: "Active",
            listing_agent_phone: "3135559090",
            days_on_market: 41,
            ordinance: "Vacant building",
            owner_name: "Plan Owner LLC",
          }];
        },
      },
    },
    target: { city: "Detroit", state: "MI" },
    thingaStore: store,
    buyers: [{ id: 1, name: "Detroit Buyer", areas: "Detroit", max_price: 250000, cash: 1 }],
    searchPlan: { id: "distress-contact", includeSourceTypes: ["violations"] },
    sourceLimit: null,
  });
  const items = store.query(null, { kind: "realEstate" });
  assert.equal(items.length, 1);
  assert.ok(items[0].parents.includes("thinga:plan-distress-contact"));
  assert.equal(items[0].schema, "realEstate.facets.v1");
  assert.equal(items[0].content.parser_family, "realEstate.faceted.v1");
  assert.equal(store.incomingLinks("thinga:plan-distress-contact", "child_of")[0].from_id, items[0].id);
});
