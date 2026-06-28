// connectors/nyc-business-licenses.js — NYC Legally Operating Businesses (Socrata)
// HAS contact_phone field — one of the few free public datasets with business phone numbers.
// Query by business name or address. Dataset: data.cityofnewyork.us/resource/w7w3-xahh.json

const NYC_URL = "https://data.cityofnewyork.us/resource/w7w3-xahh.json";

export function normalizeNycLicense(r) {
  const addr = [r.address_building, r.address_street_name, r.address_city, r.address_state, r.address_zip]
    .filter(Boolean).join(" ").trim();
  if (!r.business_name) return null;
  return {
    source_id: "nyc-business-licenses",
    source_type: "business_license_dataset",
    business_name: r.business_name || null,
    dba_name: r.dba_trade_name || null,
    license_id: r.license_nbr || null,
    license_type: r.license_type || null,
    license_status: r.license_status || null,
    address: addr || null,
    city: r.address_city || null,
    state: r.address_state || "NY",
    zip: r.address_zip || null,
    phone: r.contact_phone || null,
    email: null,
    confidence: "high",
    confidence_reason: "Official NYC business license matched by address — contact_phone field available.",
    legal_status: "public_official_api",
    contact_status: r.contact_phone ? "business_identified_public_phone_found" : "business_identified_public_phone_unknown",
  };
}

export function nycBusinessLicensesConnector({ fetchImpl = fetch } = {}) {
  return {
    id: "nyc-business-licenses",
    region: "us-ny-nyc",
    type: "public-contact",
    dialect: "socrata",
    free: true,
    legal_status: "public_official_api",
    // bulk harvest: paginate the dataset for records that HAVE a phone (powers the B2B harvest workflow).
    async harvest({ limit = 1000, offset = 0 } = {}) {
      const u = new URL(NYC_URL);
      u.searchParams.set("$where", "contact_phone IS NOT NULL");
      u.searchParams.set("$limit", String(limit));
      u.searchParams.set("$offset", String(offset));
      u.searchParams.set("$order", "license_nbr");
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 20000);
        const r = await fetchImpl(u, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map(normalizeNycLicense).filter((x) => x && x.phone);
      } catch { return []; }
    },
    async search(target = {}) {
      const u = new URL(NYC_URL);
      const clauses = [];
      if (target.business_name) {
        const n = String(target.business_name).replace(/'/g, "''");
        clauses.push(`(business_name like '%${n}%' OR dba_trade_name like '%${n}%')`);
      }
      if (target.address) {
        const a = String(target.address).replace(/'/g, "''");
        clauses.push(`address_street_name like '%${a}%'`);
      }
      if (!clauses.length) return [];
      u.searchParams.set("$where", clauses.join(" AND "));
      u.searchParams.set("$limit", "20");
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 10000);
        const r = await fetchImpl(u, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map(normalizeNycLicense).filter(Boolean);
      } catch { return []; }
    },
  };
}
