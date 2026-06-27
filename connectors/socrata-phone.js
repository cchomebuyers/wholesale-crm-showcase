// connectors/socrata-phone.js — GENERIC public-contact connector for any Socrata dataset that has a
// phone column. Config-driven: add a row to phone-sources.data.json → a new nationwide phone source,
// no new code. This is how we multiply phone leads beyond NYC across America.

export function normalizeSocrataPhone(cfg, r) {
  const phoneRaw = r[cfg.phoneCol];
  if (!phoneRaw) return null;
  const phone = String(phoneRaw).replace(/[^0-9]/g, "");
  if (phone.length < 10) return null; // drop junk/partial numbers
  const name = (cfg.nameCol && r[cfg.nameCol]) || null;
  const addr = (cfg.addrCol && r[cfg.addrCol]) || null;
  return {
    source_id: cfg.id, source_type: "license_dataset",
    business_name: name, name,
    address: typeof addr === "object" ? null : addr,
    city: cfg.city || (cfg.cityCol && r[cfg.cityCol]) || null,
    state: cfg.state || null,
    zip: (cfg.zipCol && r[cfg.zipCol]) || null,
    phone, email: null,
    confidence: "high", legal_status: "public_official_api",
  };
}

export function socrataPhoneConnector(cfg, { fetchImpl = fetch } = {}) {
  const BASE = `https://${cfg.domain}/resource/${cfg.datasetId}.json`;
  return {
    id: cfg.id, region: cfg.region || null, type: "public-contact", dialect: "socrata",
    free: true, legal_status: "public_official_api",
    async harvest({ limit = 1000, offset = 0 } = {}) {
      const u = new URL(BASE);
      u.searchParams.set("$where", `${cfg.phoneCol} IS NOT NULL`);
      u.searchParams.set("$limit", String(limit));
      u.searchParams.set("$offset", String(offset));
      u.searchParams.set("$order", ":id"); // stable pagination
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
        const r = await fetchImpl(u, { signal: ctl.signal }); clearTimeout(t);
        if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map((x) => normalizeSocrataPhone(cfg, x)).filter((x) => x && x.phone);
      } catch { return []; }
    },
    async search(target = {}) {
      if (!target.business_name) return [];
      const u = new URL(BASE);
      const n = String(target.business_name).replace(/'/g, "''");
      u.searchParams.set("$where", `upper(${cfg.nameCol}) like upper('%${n}%') AND ${cfg.phoneCol} IS NOT NULL`);
      u.searchParams.set("$limit", "20");
      try {
        const r = await fetchImpl(u); if (!r.ok) return [];
        const rows = await r.json();
        return (Array.isArray(rows) ? rows : []).map((x) => normalizeSocrataPhone(cfg, x)).filter(Boolean);
      } catch { return []; }
    },
  };
}

export function buildSocrataPhoneConnectors(configs, deps = {}) {
  return (configs || []).filter((c) => c && c.id && c.domain && c.datasetId && c.phoneCol)
    .map((c) => socrataPhoneConnector(c, deps));
}
