import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStreetViewUrl,
  createPhotoCandidates,
  displayAddress,
  extractListingPhotoUrls,
  photoMetadataForProperty,
} from "./photo_candidate_core.mjs";

test("displayAddress combines the property address fields", () => {
  assert.equal(displayAddress({ address: "10 Main St", city: "Detroit", state: "MI", zip: "48201" }), "10 Main St, Detroit, MI, 48201");
});

test("extractListingPhotoUrls finds common listing media shapes and dedupes", () => {
  const urls = extractListingPhotoUrls({
    photo_url: "https://cdn.example/a.jpg",
    media: [{ MediaURL: "https://cdn.example/b.jpg" }, { url: "https://cdn.example/a.jpg" }],
    photos: ["https://cdn.example/c.jpg"],
  });
  assert.deepEqual(urls, ["https://cdn.example/a.jpg", "https://cdn.example/c.jpg", "https://cdn.example/b.jpg"]);
});

test("Street View URL is metadata-only and requires a key", () => {
  assert.equal(buildStreetViewUrl({ address: "10 Main St", city: "Detroit", state: "MI" }, null), null);
  const url = buildStreetViewUrl({ address: "10 Main St", city: "Detroit", state: "MI" }, "abc123");
  assert.ok(url.startsWith("https://maps.googleapis.com/maps/api/streetview?"));
  assert.ok(url.includes("location=10+Main+St%2C+Detroit%2C+MI"));
  assert.ok(url.includes("key=abc123"));
});

test("photo candidates default to no cache/display rights for listing and assessor URLs", () => {
  const candidates = createPhotoCandidates({
    addr_key: "10-main",
    photo_url: "https://listing.example/10.jpg",
    assessor_photo_url: "https://county.example/10.jpg",
  }, { now: "2026-06-27T00:00:00.000Z" });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].cache_allowed, false);
  assert.equal(candidates[0].display_allowed, false);
  assert.equal(candidates[1].photo_source, "county_assessor");
});

test("photoMetadataForProperty chooses listing media before Street View", () => {
  const meta = photoMetadataForProperty({
    addr_key: "10-main",
    address: "10 Main St",
    city: "Detroit",
    state: "MI",
    photo_url: "https://listing.example/10.jpg",
  }, {
    now: "2026-06-27T00:00:00.000Z",
    googleStreetViewApiKey: "abc123",
    listingDisplayAllowed: true,
    streetViewDisplayAllowed: true,
  });
  assert.equal(meta.has_photo_candidate, true);
  assert.equal(meta.primary_photo_url, "https://listing.example/10.jpg");
  assert.equal(meta.primary_photo_source, "listing_media");
  assert.equal(meta.candidates.length, 2);
  assert.equal(meta.candidates.find((c) => c.photo_source === "google_street_view_static").cache_allowed, false);
});
