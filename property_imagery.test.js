import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPropertyImageryUrls, streetViewMetadata } from "./property_imagery.js";

test("buildPropertyImageryUrls creates Street View and satellite URLs from coordinates", () => {
  const out = buildPropertyImageryUrls({
    id: 1,
    formatted_address: "123 Industrial St, Detroit, MI",
    latitude: 42.331,
    longitude: -83.046,
  }, { googleMapsKey: "test-key" });

  assert.equal(out.ok, true);
  assert.match(out.streetViewImageUrl, /streetview/);
  assert.match(out.streetViewImageUrl, /42\.331%2C-83\.046/);
  assert.match(out.satelliteImageUrl, /maptype=satellite/);
  assert.match(out.parcelOverlayImageUrl, /maptype=hybrid/);
});

test("buildPropertyImageryUrls reports missing key without throwing", () => {
  const out = buildPropertyImageryUrls({ address: "123 Industrial St" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "google_maps_api_key missing");
});

test("streetViewMetadata normalizes Google metadata response", async () => {
  const fetchImpl = async () => ({
    json: async () => ({ status: "OK", pano_id: "abc", date: "2024-10", location: { lat: 1, lng: 2 } }),
  });
  const meta = await streetViewMetadata({ address: "123 Industrial St" }, { googleMapsKey: "k", fetchImpl });
  assert.equal(meta.ok, true);
  assert.equal(meta.pano_id, "abc");
});
