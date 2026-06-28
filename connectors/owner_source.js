// connectors/owner_source.js — GENERIC owner-join connector. Given a property's situs
// address, look up the owner of record from an official, free, county/city open-data
// source (e.g. NYC PLUTO). Config-driven like socrata-phone.js / property.js so a new
// county is one JSON row. Returns owner NAME (public record); mailing PII stays gated.
//
// Owner name is the single biggest unlock for the pro-wholesaler queue: it turns a
// pay_to_unlock property into something a skip-trace / call can act on.

const SUFFIX = {
  ST: "STREET", STR: "STREET", AVE: "AVENUE", AV: "AVENUE", BLVD: "BOULEVARD",
  RD: "ROAD", DR: "DRIVE", LN: "LANE", PL: "PLACE", CT: "COURT", PKWY: "PARKWAY",
  HWY: "HIGHWAY", TER: "TERRACE", TERR: "TERRACE", CIR: "CIRCLE", SQ: "SQUARE",
  PKY: "PARKWAY", EXPY: "EXPRESSWAY", PLZ: "PLAZA", BLVD_: "BOULEVARD",
};
// Reverse: full -> abbreviation, for sources that store abbreviated suffixes.
const SUFFIX_ABBR = { STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", ROAD: "RD",
  DRIVE: "DR", LANE: "LN", PLACE: "PL", COURT: "CT", PARKWAY: "PKWY", HIGHWAY: "HWY",
  TERRACE: "TER", CIRCLE: "CIR", SQUARE: "SQ", PLAZA: "PLZ" };

const PLACEHOLDER_OWNER = /^(unavailable|owner unavailable|unavailable owner|n\/?a|none|unknown|not available|tbd|null)$/i;

export function isPlaceholderOwner(name) {
  const s = String(name || "").trim();
  if (s.length < 2) return true;
  return PLACEHOLDER_OWNER.test(s);
}

// Normalize a situs/street address to match a source's stored form.
// style "full" expands ST->STREET (PLUTO); style "abbr" collapses STREET->ST; default raw-clean.
export function normalizeSitus(addr, style = "raw") {
  let s = String(addr || "").toUpperCase().trim();
  if (!s) return "";
  s = s.split(",")[0];                  // drop ", CITY STATE ZIP" if present
  s = s.replace(/\s+(APT|UNIT|STE|#|FL|FLOOR|RM)\b.*$/i, ""); // drop unit/apt tail
  s = s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (style === "raw") return s;
  const parts = s.split(" ");
  const last = parts[parts.length - 1];
  if (style === "full" && SUFFIX[last]) parts[parts.length - 1] = SUFFIX[last];
  else if (style === "abbr" && SUFFIX_ABBR[last]) parts[parts.length - 1] = SUFFIX_ABBR[last];
  return parts.join(" ");
}

export function normalizeOwnerHit(cfg, row) {
  if (!row) return null;
  const name = row[cfg.ownerCol];
  if (!name || isPlaceholderOwner(name)) return null;
  return {
    owner_name: String(name).trim(),
    owner_mailing: cfg.mailingCol && row[cfg.mailingCol] ? String(row[cfg.mailingCol]).trim() : null,
    apn: cfg.apnCol && row[cfg.apnCol] ? String(row[cfg.apnCol]).trim() : null,
    owner_source: cfg.id,
    legal_status: "public_official_api",
  };
}

export function ownerSourceConnector(cfg, { fetchImpl = fetch } = {}) {
  const BASE = `https://${cfg.domain}/resource/${cfg.datasetId}.json`;
  return {
    id: cfg.id, region: cfg.region || null, state: cfg.state || null,
    type: "owner-source", dialect: "socrata", free: true, legal_status: "public_official_api",
    // lookup(situs) -> owner record or null
    async lookup(situs) {
      const norm = normalizeSitus(situs, cfg.addrStyle || "full");
      if (!norm || norm.length < 4) return null;
      const u = new URL(BASE);
      const cols = [cfg.addrCol, cfg.ownerCol, cfg.mailingCol, cfg.apnCol].filter(Boolean);
      u.searchParams.set("$select", cols.join(","));
      u.searchParams.set("$where", `upper(${cfg.addrCol})=upper('${norm.replace(/'/g, "''")}')`);
      u.searchParams.set("$limit", "1");
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const r = await fetchImpl(u, { signal: ctl.signal }); clearTimeout(t);
        if (!r.ok) return null;
        const rows = await r.json();
        return normalizeOwnerHit(cfg, Array.isArray(rows) ? rows[0] : null);
      } catch { return null; }
    },
  };
}

export function buildOwnerSources(configs, deps = {}) {
  return (configs || [])
    .filter((c) => c && c.id && c.domain && c.datasetId && c.addrCol && c.ownerCol)
    .map((c) => ownerSourceConnector(c, deps));
}
