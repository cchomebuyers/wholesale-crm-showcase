// connectors/epa-envirofacts.js — free EPA FRS facility search connector.
//
// Queries the EPA Envirofacts Facility Registry Service (FRS) for industrial/commercial
// facilities by city/state/zip/county/name. Returns normalized public-contact candidates.
// This is NOT homeowner skip-trace — it finds industrial operators/facilities where
// contact information sometimes appears in public regulatory records.
//
// API: https://data.epa.gov/efservice/  (REST, GET, JSON, no key, free)
// FRS docs: facility_name, city, county, state, zip searchable via query params.

const EPA_BASE = "https://data.epa.gov/efservice";

// Normalize an EPA FRS facility record → public-contact candidate.
// Actual EPA FRS field names (verified via live probe 2026-06-26):
// primary_name, registry_id, location_address, city_name, state_code, postal_code,
// std_full_address, county_name, site_type_name, epa_region_code, location_description
// Note: EPA FRS city query matches on the REGISTERED LOCATION address, not the
// facility's physical site. The std_* fields hold the actual facility location.
export function normalizeEpaFacility(r) {
  // Use std_full_address for the actual facility location if available
  const addr = r.std_full_address || r.location_address || null;
  if (!addr) return null;
  return {
    source_id: "epa-envirofacts-frs",
    source_type: "public_industrial_facility",
    facility_name: r.primary_name || null,
    registry_id: r.registry_id || null,
    facility_address: r.std_full_address || null,
    location_address: r.location_address || null,
    city: r.std_city_name || null,
    state: r.std_state_code || null,
    zip: r.std_postal_code || null,
    county: r.county_name || r.std_county_name || null,
    site_type: r.site_type_name || null,
    epa_region: r.epa_region_code || null,
    location_description: r.location_description || null,
    data_quality: r.data_quality_code || null,
    phone: null,
    email: null,
    contact_name: null,
    confidence: "medium",
    confidence_reason: "Official EPA FRS facility matched by registered location address.",
    legal_status: "public_official_api",
    contact_status: "facility_identified_public_phone_unknown",
  };
}

// Query EPA FRS facilities by location fields.
async function searchEpa(target = {}, fetchImpl = fetch) {
  // FRS query uses path segments: /FRS_FACILITY_SITE/state_abbr/ST/city/CITYNAME
  // Or simpler: GET parameters
  // Best approach: use the FACILITY_SITE table with query params
  const params = new URLSearchParams();
  
  // Build query — FRS supports filtering by state + city or state + zip
  // URL pattern: /efservice/FRS_FACILITY_SITE/state_abbr/{STATE}/city_name/{CITY}/JSON
  let url;
  
  if (target.state && target.city) {
    // Path-based query: most reliable
    const st = String(target.state).toUpperCase().slice(0, 2);
    const city = String(target.city).replace(/\//g, " ").trim();
    url = `${EPA_BASE}/FRS_FACILITY_SITE/state_abbr/${st}/city_name/${encodeURIComponent(city)}/JSON`;
  } else if (target.state && target.zip) {
    const st = String(target.state).toUpperCase().slice(0, 2);
    url = `${EPA_BASE}/FRS_FACILITY_SITE/state_abbr/${st}/zip_code/${target.zip}/JSON`;
  } else if (target.state) {
    const st = String(target.state).toUpperCase().slice(0, 2);
    url = `${EPA_BASE}/FRS_FACILITY_SITE/state_abbr/${st}/JSON`;
  } else if (target.zip) {
    url = `${EPA_BASE}/FRS_FACILITY_SITE/zip_code/${target.zip}/JSON`;
  } else if (target.facility_name) {
    const name = String(target.facility_name).replace(/\//g, " ").trim();
    url = `${EPA_BASE}/FRS_FACILITY_SITE/primary_name/${encodeURIComponent(name)}/JSON`;
  } else {
    return []; // insufficient input
  }
  
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetchImpl(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const rows = await r.json();
    const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    // EPA returns header row as first element — skip it
    const data = arr.length > 0 && typeof arr[0] === "object" && arr[0].REGISTRY_ID === "REGISTRY_ID" ? arr.slice(1) : arr;
    return data.map(normalizeEpaFacility).filter(Boolean).slice(0, 50);
  } catch {
    return [];
  }
}

export function epaEnvirofactsConnector({ fetchImpl = fetch } = {}) {
  return {
    id: "epa-envirofacts-frs",
    region: "us",
    type: "public-contact",
    dialect: "epa-frs",
    free: true,
    legal_status: "public_official_api",
    async search(target = {}) {
      return await searchEpa(target, fetchImpl);
    },
  };
}
