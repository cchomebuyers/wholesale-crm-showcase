import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyCursor,
  isNewListing,
  listingIdentity,
  newestTimestamp,
  normalizeNewListings,
  updateListingCursor,
} from "./listing_alert_core.mjs";

test("listingIdentity prefers source_id then address key", () => {
  assert.equal(listingIdentity({ source_id: "abc", addr_key: "x" }), "abc");
  assert.equal(listingIdentity({ addr_key: "5 ELM" }), "5 ELM");
});

test("cursor suppresses already-seen listing ids", () => {
  const cursor = { seen: { "rentcast-sale": ["L1"] }, sources: {} };
  assert.equal(isNewListing({ source_id: "L1" }, cursor, "rentcast-sale"), false);
  assert.equal(isNewListing({ source_id: "L2" }, cursor, "rentcast-sale"), true);
});

test("updateListingCursor records seen ids and newest timestamp", () => {
  const next = updateListingCursor(emptyCursor(), "reso-mls", [
    { source_id: "A", listed_date: "2026-06-01T00:00:00Z" },
    { source_id: "B", listed_date: "2026-06-02T00:00:00Z" },
  ]);
  assert.deepEqual(next.seen["reso-mls"], ["A", "B"]);
  assert.equal(next.sources["reso-mls"].last_seen_listing_id, "B");
  assert.equal(next.sources["reso-mls"].last_seen_modification_timestamp, "2026-06-02T00:00:00.000Z");
  assert.equal(next.sources["reso-mls"].source_error_count, 0);
});

test("updateListingCursor increments errors without clearing last success", () => {
  const first = updateListingCursor(emptyCursor(), "rentcast-sale", [{ source_id: "A" }]);
  const second = updateListingCursor(first, "rentcast-sale", [], { ok: false });
  assert.equal(second.sources["rentcast-sale"].source_error_count, 1);
  assert.ok(second.sources["rentcast-sale"].last_success_at);
});

test("newestTimestamp picks the most recent known timestamp field", () => {
  assert.equal(newestTimestamp([
    { updated_at: "2026-01-01T00:00:00Z" },
    { listedDate: "2026-01-03T00:00:00Z" },
  ]), "2026-01-03T00:00:00.000Z");
});

test("normalizeNewListings gates seen records and returns property shape", () => {
  const cursor = { seen: { "rentcast-sale": ["old"] }, sources: {} };
  const out = normalizeNewListings([
    { source_id: "old", formatted_address: "1 A", status: "Active" },
    { source_id: "new", formatted_address: "2 B", status: "Active" },
  ], { id: "rentcast-sale", type: "listings" }, cursor);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_id, "new");
  assert.equal(out[0].outreach_allowed, false);
});
