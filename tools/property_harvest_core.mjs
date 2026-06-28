import { canonicalAddr } from "../connectors/census.js";

const SOURCE_TYPES = new Set(["property", "violations", "parcels", "listings"]);
const NON_LEAD_TYPES = new Set(["comps", "geocode", "public-contact", "paid-skiptrace"]);

const clean = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

export function isPropertySource(conn) {
  if (!conn || typeof conn.search !== "function") return false;
  if (NON_LEAD_TYPES.has(conn.type)) return false;
  return SOURCE_TYPES.has(conn.type);
}

export function propertyAddrKey(row = {}) {
  const address = clean(row.formatted_address) || clean(row.address);
  const city = clean(row.city);
  const state = clean(row.state);
  const zip = clean(row.zip);
  const parts = [address, city, state, zip].filter(Boolean);
  return canonicalAddr(parts.join(" "));
}

export function distressFrom(row = {}, conn = {}) {
  const hay = [
    row.distress,
    row.motivation,
    row.ordinance,
    row.status,
    row.source,
    conn.type,
    conn.id,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/tax|delinquent|lien/.test(hay)) return "tax_delinquent";
  if (/vacant/.test(hay)) return "vacant";
  if (/abandon/.test(hay)) return "abandoned";
  if (/condemn|unsafe|nuisance|demolition|board/.test(hay)) return "condemned_or_unsafe";
  if (/foreclosure|pre.?foreclosure|auction|sheriff/.test(hay)) return "foreclosure";
  if (/listing|active|reso|rentcast/.test(hay)) return "on_market";
  if (/parcel|owner|assess|tax roll/.test(hay)) return "parcel_owner_record";
  return "code_violation";
}

export function scorePropertyLead(row = {}) {
  const distress = distressFrom(row);
  const weights = {
    tax_delinquent: 85,
    condemned_or_unsafe: 82,
    abandoned: 80,
    vacant: 76,
    foreclosure: 74,
    code_violation: 68,
    on_market: 45,
    parcel_owner_record: 28,
  };
  let distressScore = weights[distress] ?? 45;

  if (row.absentee) distressScore += 12;
  if (row.owner_mailing && row.address && canonicalAddr(row.owner_mailing) !== canonicalAddr(row.address)) distressScore += 8;
  if (row.balance_due) distressScore += 8;
  if (row.price && row.arv && Number(row.price) < Number(row.arv) * 0.75) distressScore += 10;
  if (row.days_on_market && Number(row.days_on_market) > 45) distressScore += 8;

  distressScore = Math.max(0, Math.min(100, Math.round(distressScore)));
  const motivationScore = Math.max(0, Math.min(100, Math.round(distressScore * 0.85 + (row.owner_name || row.seller_name ? 8 : 0))));
  const leadScore = Math.round(Math.min(100, distressScore * 0.55 + motivationScore * 0.45));
  return { distress_score: distressScore, motivation_score: motivationScore, lead_score: leadScore };
}

export function normalizePropertyRecord(row = {}, conn = {}, harvestedAt = new Date().toISOString()) {
  const address = clean(row.formatted_address) || clean(row.address);
  if (!address) return null;
  const addrKey = propertyAddrKey(row);
  if (!addrKey) return null;
  const ownerName = clean(row.owner_name) || clean(row.seller_name);
  const ownerMailing = clean(row.owner_mailing) || clean(row.property_owner_address);
  const distress = distressFrom(row, conn);
  const signal = {
    source: conn.id || row.source || "unknown",
    source_type: conn.type || row.type || null,
    distress,
    motivation: clean(row.motivation) || distress,
    source_id: clean(row.source_id) || clean(row.parcel_id) || null,
    observed_at: harvestedAt,
  };
  const out = {
    key: addrKey,
    addr_key: addrKey,
    address,
    formatted_address: clean(row.formatted_address) || address,
    city: clean(row.city),
    state: clean(row.state) || clean(conn.state),
    zip: clean(row.zip),
    county: clean(row.county) || clean(conn.county),
    latitude: row.latitude ?? row.lat ?? null,
    longitude: row.longitude ?? row.lon ?? null,
    source: conn.id || row.source || "unknown",
    source_type: conn.type || row.type || null,
    source_id: signal.source_id,
    distress,
    motivation: signal.motivation,
    owner_name: ownerName,
    owner_mailing: ownerMailing,
    parcel_id: clean(row.parcel_id),
    price: row.price ?? null,
    status: clean(row.status),
    listed_date: clean(row.listed_date),
    days_on_market: row.days_on_market ?? null,
    legal_status: row.legal_status || conn.legal_status || "public_official_api",
    contact_status: "not_enriched",
    outreach_allowed: false,
    compliance_status: "unchecked",
    harvested_at: harvestedAt,
    signals: [signal],
  };
  return { ...out, ...scorePropertyLead(out) };
}

export function mergePropertyRecords(a, b) {
  if (!a) return b;
  if (!b) return a;
  const signals = [];
  const seen = new Set();
  for (const s of [...(a.signals || []), ...(b.signals || [])]) {
    const key = `${s.source}|${s.source_id || ""}|${s.distress || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(s);
  }
  const pick = (...vals) => vals.find((v) => v != null && v !== "") ?? null;
  const merged = {
    ...a,
    address: pick(a.address, b.address),
    formatted_address: pick(a.formatted_address, b.formatted_address),
    city: pick(a.city, b.city),
    state: pick(a.state, b.state),
    zip: pick(a.zip, b.zip),
    county: pick(a.county, b.county),
    latitude: pick(a.latitude, b.latitude),
    longitude: pick(a.longitude, b.longitude),
    owner_name: pick(a.owner_name, b.owner_name),
    owner_mailing: pick(a.owner_mailing, b.owner_mailing),
    parcel_id: pick(a.parcel_id, b.parcel_id),
    price: pick(a.price, b.price),
    status: pick(a.status, b.status),
    listed_date: pick(a.listed_date, b.listed_date),
    days_on_market: pick(a.days_on_market, b.days_on_market),
    harvested_at: pick(b.harvested_at, a.harvested_at),
    signals,
  };
  const score = scorePropertyLead({ ...merged, distress: strongestDistress(signals) || merged.distress });
  merged.distress = strongestDistress(signals) || merged.distress;
  merged.motivation = signals.map((s) => s.motivation).filter(Boolean).join("; ");
  return { ...merged, ...score };
}

function strongestDistress(signals = []) {
  const order = ["tax_delinquent", "condemned_or_unsafe", "abandoned", "vacant", "foreclosure", "code_violation", "on_market", "parcel_owner_record"];
  const present = new Set(signals.map((s) => s.distress).filter(Boolean));
  return order.find((x) => present.has(x)) || null;
}

export function mergeBatch(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row || !row.addr_key) continue;
    byKey.set(row.addr_key, mergePropertyRecords(byKey.get(row.addr_key), row));
  }
  return [...byKey.values()];
}
