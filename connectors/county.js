// connectors/county.js — generic ArcGIS / Socrata county connector factory.
//
// The whole point: adding a metro becomes ONE verified config entry, not new code. Each US county
// publishes its own open data (free), so "every inch of America" = a registry of county configs.
// This factory turns a config into the standard search(target) → [normalizedLead] interface.

// Build a normalizer from a PURE-DATA field map, so county configs can live in JSON and a background
// agent can append them without writing code. fieldmap keys point at the source's column names.
export function buildMap(fieldmap, source) {
  const F = fieldmap || {};
  const g = (a, key) => (key && a[key] != null && a[key] !== "" ? a[key] : null);
  return (a) => {
    const address = g(a, F.address) ||
      [g(a, F.house_number), g(a, F.street)].filter(Boolean).join(" ") || null;
    if (!address) return null;
    return {
      addr_key: String(address).toLowerCase(), source,
      address, city: g(a, F.city), state: g(a, F.state), zip: g(a, F.zip),
      seller_name: g(a, F.owner), motivation: F.motivation || "Code violation",
      ordinance: g(a, F.ordinance) || g(a, F.description),
      latitude: g(a, F.lat), longitude: g(a, F.lon),
    };
  };
}

// ArcGIS FeatureServer connector. cfg:
//   { id, region, type, url, where(target)|string, fields[], map(attrs)->lead | fieldmap, max }
export function arcgisCounty(cfg) {
  const map = cfg.map || buildMap(cfg.fieldmap, cfg.id);
  return {
    id: cfg.id, region: cfg.region, type: cfg.type || "violations",
    async search(target = {}) {
      const where = typeof cfg.where === "function" ? cfg.where(target) : (cfg.where || "1=1");
      const out = []; let offset = 0; const page = 1000; const max = cfg.max || 2000;
      while (out.length < max) {
        const u = new URL(cfg.url);
        u.searchParams.set("where", where);
        u.searchParams.set("outFields", (cfg.fields || ["*"]).join(","));
        u.searchParams.set("resultRecordCount", String(page));
        u.searchParams.set("resultOffset", String(offset));
        u.searchParams.set("f", "json");
        const r = await fetch(u);
        const j = await r.json();
        const feats = j.features || [];
        if (!feats.length) break;
        out.push(...feats.map((f) => map(f.attributes)).filter(Boolean));
        if (feats.length < page) break;
        offset += page;
      }
      return out.slice(0, max);
    },
  };
}

// Socrata connector. cfg: { id, region, type, url (resource .json), where(target)|string, map|fieldmap, max }
export function socrataCounty(cfg) {
  const map = cfg.map || buildMap(cfg.fieldmap, cfg.id);
  return {
    id: cfg.id, region: cfg.region, type: cfg.type || "violations",
    async search(target = {}) {
      const where = typeof cfg.where === "function" ? cfg.where(target) : cfg.where;
      const u = new URL(cfg.url);
      if (where) u.searchParams.set("$where", where);
      u.searchParams.set("$limit", String(cfg.max || 2000));
      const token = cfg.appToken; if (token) u.searchParams.set("$$app_token", token);
      const r = await fetch(u);
      const rows = await r.json();
      return (Array.isArray(rows) ? rows : []).map(map).filter(Boolean);
    },
  };
}

// Build connectors from a county-config list — only those with a verified endpoint are registered.
export function buildCountyConnectors(configs) {
  const out = [];
  for (const c of configs) {
    if (!c.endpoint) continue;            // unverified → skip (no red sources on the scoreboard)
    if (c.dialect === "socrata") out.push(socrataCounty({ ...c, url: c.endpoint }));
    else out.push(arcgisCounty({ ...c, url: c.endpoint }));
  }
  return out;
}
