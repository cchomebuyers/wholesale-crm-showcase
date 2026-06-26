// connectors/census.js — US Census Geocoder (free, no key) + a pure address canonicalizer.
// Two free wins: (1) canonicalAddr() normalizes addresses in-process so "123 Main St" and
// "123 MAIN STREET" dedupe to one — instant, no network; (2) geocodeAddress() hits the Census
// one-line geocoder for a standardized address + lat/lng (used for precise dedup / mapping).

const SUFFIX = {
  STREET: "ST", AVENUE: "AVE", AV: "AVE", ROAD: "RD", DRIVE: "DR", BOULEVARD: "BLVD",
  LANE: "LN", COURT: "CT", PLACE: "PL", TERRACE: "TER", PARKWAY: "PKWY", HIGHWAY: "HWY",
  CIRCLE: "CIR", SQUARE: "SQ", TRAIL: "TRL", POINT: "PT", PLAZA: "PLZ", CRESCENT: "CRES",
};
const DIR = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW" };

// Pure, network-free canonical form for dedup keys.
export function canonicalAddr(s) {
  if (!s) return "";
  let v = String(s).toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  v = v.split(" ").map((w) => SUFFIX[w] || DIR[w] || w).join(" ");
  return v;
}

// Free geocode via the US Census one-line geocoder (no key, US addresses).
export async function geocodeAddress(address) {
  if (!address) return { matched: false };
  const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  u.searchParams.set("address", address);
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("format", "json");
  try {
    const r = await fetch(u);
    const j = await r.json();
    const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
    if (!m) return { matched: false };
    return { matched: true, standardized: m.matchedAddress, lat: m.coordinates && m.coordinates.y, lon: m.coordinates && m.coordinates.x };
  } catch (e) {
    return { matched: false, error: String(e.message || e) };
  }
}

// A free, no-key connector so the scoreboard tracks it. type:"geocode" (not a lead source — the
// area pull skips non-lead types). search({address}) → standardized address + coords if matched.
export function censusConnector() {
  return {
    id: "census-geocode", region: "us", type: "geocode",
    async search(target) {
      const g = await geocodeAddress(target && target.address);
      return g.matched ? [{ formatted_address: g.standardized, latitude: g.lat, longitude: g.lon, source: "census" }] : [];
    },
  };
}
