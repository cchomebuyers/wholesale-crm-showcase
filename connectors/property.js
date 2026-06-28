// connectors/property.js — GENERIC distressed-PROPERTY connector. These return HOUSES (real-estate
// wholesale leads), not businesses: code violations / vacant / abandoned / condemned properties =
// motivated-seller signals. Config-driven like socrata-phone.js. Address may be one column (addrCol)
// or assembled from parts (addrParts). Output kind = "property".

function val(r, col) { const v = col ? r[col] : null; return (v && typeof v === "object") ? null : v; }

export function normalizeProperty(cfg, r) {
  let address = cfg.addrCol ? val(r, cfg.addrCol) : null;
  if (!address && Array.isArray(cfg.addrParts)) {
    address = cfg.addrParts.map((c) => val(r, c)).filter(Boolean).join(" ").trim();
  }
  if (!address || typeof address !== "string" || address.trim().length < 4) return null;
  return {
    source_id: cfg.id, type: "property", kind: "property",
    address: address.trim(),
    city: val(r, cfg.cityCol) || cfg.city || null,
    state: val(r, cfg.stateCol) || cfg.state || null,
    zip: val(r, cfg.zipCol) || null,
    lat: val(r, cfg.latCol) || null, lon: val(r, cfg.lonCol) || null,
    distress: cfg.distress || "code_violation",
    status: val(r, cfg.statusCol) || null,
    legal_status: "public_official_api",
  };
}

export function propertyConnector(cfg, { fetchImpl = fetch } = {}) {
  const BASE = `https://${cfg.domain}/resource/${cfg.datasetId}.json`;
  return {
    id: cfg.id, region: cfg.region || null, type: "property", dialect: "socrata",
    free: true, legal_status: "public_official_api", distress: cfg.distress || "code_violation",
    async harvest({ limit = 1000, offset = 0 } = {}) {
      const u = new URL(BASE);
      u.searchParams.set("$limit", String(limit));
      u.searchParams.set("$offset", String(offset));
      u.searchParams.set("$order", ":id");
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
        const r = await fetchImpl(u, { signal: ctl.signal }); clearTimeout(t);
        if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map((x) => normalizeProperty(cfg, x)).filter(Boolean);
      } catch { return []; }
    },
    async search(target = {}) {
      if (!target.address || !cfg.addrCol) return [];
      const u = new URL(BASE);
      const a = String(target.address).replace(/'/g, "''");
      u.searchParams.set("$where", `upper(${cfg.addrCol}) like upper('%${a}%')`);
      u.searchParams.set("$limit", "25");
      try {
        const r = await fetchImpl(u); if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map((x) => normalizeProperty(cfg, x)).filter(Boolean);
      } catch { return []; }
    },
  };
}

export function buildPropertyConnectors(configs, deps = {}) {
  return (configs || []).filter((c) => c && c.id && c.domain && c.datasetId && (c.addrCol || c.addrParts))
    .map((c) => propertyConnector(c, deps));
}
