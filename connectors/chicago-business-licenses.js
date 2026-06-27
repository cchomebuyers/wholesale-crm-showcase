// connectors/chicago-business-licenses.js — free Chicago business license Socrata connector.
//
// Proves the pattern: official city open data portals expose business contact fields
// that can be queried by address/business name. This is NOT homeowner skip-trace —
// it finds businesses operating at a specific address or under a specific name.
//
// Dataset: City of Chicago Business Licenses (Socrata)
// URL: https://data.cityofchicago.org/resource/r5kz-chrr.json

const CHICAGO_URL = "https://data.cityofchicago.org/resource/r5kz-chrr.json";

// Normalize a Chicago business license row → public-contact candidate.
// Actual Chicago Socrata field names (verified via live probe 2026-06-26):
// legal_name, doing_business_as_name, address, city, state, zip_code,
// license_id, license_description, business_activity, license_status,
// account_number, site_number, application_type, expiration_date
// Note: No phone field in this dataset. Business identity only.
export function normalizeChicagoLicense(r) {
  if (!r.legal_name) return null;
  return {
    source_id: "chicago-business-licenses",
    source_type: "business_license_dataset",
    business_name: r.legal_name || null,
    dba_name: r.doing_business_as_name || null,
    license_id: r.license_id || r.id || null,
    license_description: r.license_description || null,
    business_activity: r.business_activity || null,
    license_status: r.license_status || null,
    address: r.address || null,
    city: r.city || null,
    state: r.state || null,
    zip: r.zip_code || null,
    phone: null,
    email: null,
    confidence: "high",
    confidence_reason: "Official Chicago business license matched by address. No phone field in dataset.",
    legal_status: "public_official_api",
    contact_status: "business_identified_public_phone_unknown",
  };
}

// Search Chicago business licenses by address, name, or zip.
async function searchChicago(target = {}, fetchImpl = fetch) {
  const u = new URL(CHICAGO_URL);
  
  // Socrata SoQL: build $where clause
  const clauses = [];
  if (target.address) {
    const addr = String(target.address).replace(/'/g, "''");
    clauses.push(`address like '%${addr}%'`);
  }
  if (target.business_name) {
    const name = String(target.business_name).replace(/'/g, "''");
    clauses.push(`(legal_name like '%${name}%' OR doing_business_as_name like '%${name}%')`);
  }
  if (target.zip) {
    clauses.push(`zip_code = '${target.zip}'`);
  }
  
  if (!clauses.length) return []; // need at least one filter
  
  u.searchParams.set("$where", clauses.join(" AND "));
  u.searchParams.set("$limit", "20");
  u.searchParams.set("$order", "license_id DESC");
  
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetchImpl(u, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const rows = await r.json();
    return (Array.isArray(rows) ? rows : []).map(normalizeChicagoLicense).filter(Boolean);
  } catch {
    return [];
  }
}

export function chicagoBusinessLicensesConnector({ fetchImpl = fetch } = {}) {
  return {
    id: "chicago-business-licenses",
    region: "us-il-cook",
    type: "public-contact",
    dialect: "socrata",
    free: true,
    legal_status: "public_official_api",
    async search(target = {}) {
      return await searchChicago(target, fetchImpl);
    },
  };
}
