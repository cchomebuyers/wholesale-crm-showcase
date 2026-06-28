// property_imagery.js -- property evidence imagery for acquisitions.
//
// Google supplies street/satellite imagery. County GIS supplies parcel geometry.
// This module keeps those roles separate: it can generate Street View / Static
// Map evidence from address or coordinates, and it can overlay parcel geometry
// only when a county source has already provided that geometry.

const GOOGLE_STREETVIEW_META = "https://maps.googleapis.com/maps/api/streetview/metadata";
const GOOGLE_STREETVIEW_IMAGE = "https://maps.googleapis.com/maps/api/streetview";
const GOOGLE_STATIC_MAP = "https://maps.googleapis.com/maps/api/staticmap";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function propertyLocation(p = {}) {
  const lat = num(p.latitude ?? p.lat);
  const lon = num(p.longitude ?? p.lon);
  const address = p.formatted_address || p.address || null;
  if (lat != null && lon != null) return { location: `${lat},${lon}`, lat, lon, address };
  if (address) return { location: address, lat: null, lon: null, address };
  return null;
}

function addCommonStaticParams(url, key, size = "640x420") {
  url.searchParams.set("size", size);
  url.searchParams.set("key", key);
  return url;
}

function encodePathFromGeometry(geometry) {
  if (!geometry) return null;
  const parsed = typeof geometry === "string" ? JSON.parse(geometry) : geometry;
  const coords = parsed.coordinates || parsed.rings || parsed.paths || null;
  const ring = Array.isArray(coords?.[0]?.[0]?.[0]) ? coords[0][0]
    : Array.isArray(coords?.[0]?.[0]) ? coords[0]
    : Array.isArray(coords) ? coords
    : null;
  if (!ring || !ring.length) return null;
  const points = ring.slice(0, 80).map((pt) => {
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat},${lon}` : null;
  }).filter(Boolean);
  return points.length >= 3 ? `color:0x00b3ffcc|weight:3|fillcolor:0x00b3ff22|${points.join("|")}` : null;
}

export function buildPropertyImageryUrls(property, { googleMapsKey, parcelGeometry = null } = {}) {
  const loc = propertyLocation(property);
  if (!loc) return { ok: false, error: "property needs address or coordinates" };
  if (!googleMapsKey) return {
    ok: false,
    error: "google_maps_api_key missing",
    location: loc,
    freeFallback: "OpenStreetMap pins are already available in the Map tab; Google imagery needs a key.",
  };

  const street = addCommonStaticParams(new URL(GOOGLE_STREETVIEW_IMAGE), googleMapsKey);
  street.searchParams.set("location", loc.location);
  street.searchParams.set("fov", "80");
  street.searchParams.set("pitch", "0");

  const satellite = addCommonStaticParams(new URL(GOOGLE_STATIC_MAP), googleMapsKey);
  satellite.searchParams.set("center", loc.location);
  satellite.searchParams.set("zoom", "20");
  satellite.searchParams.set("maptype", "satellite");
  satellite.searchParams.set("markers", `color:red|${loc.location}`);

  const parcel = addCommonStaticParams(new URL(GOOGLE_STATIC_MAP), googleMapsKey);
  parcel.searchParams.set("center", loc.location);
  parcel.searchParams.set("zoom", "20");
  parcel.searchParams.set("maptype", "hybrid");
  parcel.searchParams.set("markers", `color:red|${loc.location}`);
  const path = parcelGeometry ? encodePathFromGeometry(parcelGeometry) : null;
  if (path) parcel.searchParams.append("path", path);

  return {
    ok: true,
    location: loc,
    streetViewImageUrl: street.toString(),
    satelliteImageUrl: satellite.toString(),
    parcelOverlayImageUrl: parcel.toString(),
    parcelOverlayStatus: path ? "county_geometry_overlayed" : "no_county_geometry_yet",
  };
}

export async function streetViewMetadata(property, { googleMapsKey, fetchImpl = fetch } = {}) {
  const loc = propertyLocation(property);
  if (!loc) return { ok: false, status: "NO_LOCATION" };
  if (!googleMapsKey) return { ok: false, status: "NO_KEY" };
  const url = new URL(GOOGLE_STREETVIEW_META);
  url.searchParams.set("location", loc.location);
  url.searchParams.set("key", googleMapsKey);
  const r = await fetchImpl(url);
  const data = await r.json().catch(() => ({}));
  return {
    ok: data.status === "OK",
    status: data.status || "UNKNOWN",
    pano_id: data.pano_id || data.pano || null,
    date: data.date || null,
    location: data.location || null,
    copyright: data.copyright || null,
  };
}

export async function buildPropertyImageryEvidence(property, opts = {}) {
  const urls = buildPropertyImageryUrls(property, opts);
  const metadata = opts.googleMapsKey ? await streetViewMetadata(property, opts) : { ok: false, status: "NO_KEY" };
  return {
    source_id: "google-maps-imagery",
    source_type: "property_imagery",
    legal_status: "licensed_api",
    generated_at: new Date().toISOString(),
    provider: "google_maps",
    property_id: property.id ?? null,
    address: property.formatted_address || property.address || null,
    latitude: property.latitude ?? null,
    longitude: property.longitude ?? null,
    street_view: {
      available: metadata.ok,
      metadata,
      image_url: urls.ok && metadata.ok ? urls.streetViewImageUrl : null,
    },
    satellite: {
      available: Boolean(urls.ok),
      image_url: urls.ok ? urls.satelliteImageUrl : null,
    },
    parcel_overlay: {
      available: Boolean(urls.ok),
      status: urls.parcelOverlayStatus || "unavailable",
      image_url: urls.ok ? urls.parcelOverlayImageUrl : null,
    },
    error: urls.ok ? null : urls.error,
  };
}
