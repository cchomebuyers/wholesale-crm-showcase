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

// House number + first street-name word (directionals dropped) — the anchor for a safe
// second-pass lookup when an exact address match misses (unit/suffix/direction differences).
export function houseStreetKey(addr) {
  const s = String(addr || "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  const m = s.match(/^(\d+)\s+(.*)$/);
  if (!m) return null;
  const words = m[2].split(" ").filter((w) => w && !/^(N|S|E|W|NE|NW|SE|SW)$/.test(w));
  if (!words[0]) return null;
  return `${m[1]} ${words[0]}`;
}

export function ownerSourceConnector(cfg, { fetchImpl = fetch } = {}) {
  const BASE = `https://${cfg.domain}/resource/${cfg.datasetId}.json`;
  return {
    id: cfg.id, region: cfg.region || null, state: cfg.state || null,
    type: "owner-source", dialect: "socrata", free: true, legal_status: "public_official_api",
    // lookup(situs) -> owner record or null. Pass 1: exact normalized match. Pass 2 (fallback,
    // unless cfg.fuzzyFallback === false): anchored house# + first street word via LIKE, which
    // recovers misses from unit/suffix/direction differences between our address and the roll's.
    async lookup(situs) {
      const norm = normalizeSitus(situs, cfg.addrStyle || "full");
      if (!norm || norm.length < 4) return null;
      const cols = [cfg.addrCol, cfg.ownerCol, cfg.mailingCol, cfg.apnCol].filter(Boolean);
      const esc = (s) => String(s).replace(/'/g, "''");
      const run = async (whereClause) => {
        const u = new URL(BASE);
        u.searchParams.set("$select", cols.join(","));
        u.searchParams.set("$where", whereClause);
        if (cfg.latestBy) u.searchParams.set("$order", `${cfg.latestBy} DESC`);
        u.searchParams.set("$limit", "1");
        try {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
          const r = await fetchImpl(u, { signal: ctl.signal }); clearTimeout(t);
          if (!r.ok) return null;
          const rows = await r.json();
          return normalizeOwnerHit(cfg, Array.isArray(rows) ? rows[0] : null);
        } catch { return null; }
      };
      const exact = await run(`upper(${cfg.addrCol})=upper('${esc(norm)}')`);
      if (exact || cfg.fuzzyFallback === false) return exact;
      const key = houseStreetKey(norm);
      if (!key) return null;
      const [house, street] = key.split(" ");
      return run(`upper(${cfg.addrCol}) like upper('${esc(house)} %${esc(street)}%')`);
    },
  };
}

export function buildOwnerSources(configs, deps = {}) {
  return (configs || [])
    .filter((c) => c && c.id && c.domain && c.datasetId && c.addrCol && c.ownerCol)
    .map((c) => ownerSourceConnector(c, deps));
}
