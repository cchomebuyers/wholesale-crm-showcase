import express from "express";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Minimal .env loader (no dependency) ----------
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

// ---------- Database ----------
const db = new DatabaseSync(join(__dirname, "crm.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'New',
    seller_name TEXT, seller_phone TEXT, seller_email TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    property_type TEXT, beds TEXT, baths TEXT, sqft TEXT,
    asking_price REAL, arv REAL, repair_estimate REAL,
    offer_amount REAL, contract_price REAL, assignment_fee REAL,
    motivation TEXT, source TEXT, next_followup TEXT, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    body TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS buyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT, phone TEXT, email TEXT,
    areas TEXT, property_types TEXT, max_price REAL,
    cash INTEGER DEFAULT 1, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT, subject TEXT, body TEXT, audience TEXT DEFAULT 'leads'
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    created_at TEXT NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    done INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    city TEXT, state TEXT, zip TEXT,
    property_type TEXT, status TEXT DEFAULT 'Active',
    price_min REAL, price_max REAL,
    beds_min REAL, baths_min REAL, sqft_min REAL,
    days_on_market_min INTEGER,
    last_run TEXT, last_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addr_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen TEXT,
    campaign_id INTEGER,
    source TEXT DEFAULT 'rentcast',
    source_id TEXT,
    formatted_address TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, county TEXT,
    latitude REAL, longitude REAL,
    property_type TEXT, bedrooms REAL, bathrooms REAL, square_footage REAL, lot_size REAL, year_built INTEGER,
    status TEXT, price REAL, listed_date TEXT, removed_date TEXT, days_on_market INTEGER,
    price_history TEXT,
    -- scoring/analysis (filled in Phase 2)
    lead_score INTEGER, motivation_score INTEGER, distress_score INTEGER, wholesale_score INTEGER,
    arv REAL, repair_estimate REAL, spread REAL, equity REAL, cap_rate REAL, rent_estimate REAL,
    -- pipeline
    review_status TEXT DEFAULT 'New',
    imported_lead_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_props_score ON properties(lead_score);
`);

// Migrations for columns added after first release
for (const col of ["mao REAL", "discount_pct REAL",
  "listing_agent_name TEXT", "listing_agent_phone TEXT", "listing_agent_email TEXT",
  "crime_shootings_30d INTEGER", "ai_analysis TEXT"]) {
  try { db.exec(`ALTER TABLE properties ADD COLUMN ${col}`); } catch { /* already exists */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL, type TEXT, title TEXT, body TEXT,
  property_id INTEGER, read INTEGER DEFAULT 0
);`);
// Unified email log — both inbound (synced from IMAP) and outbound (sent from the CRM).
db.exec(`CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER, direction TEXT NOT NULL,
  from_name TEXT, from_addr TEXT, to_addr TEXT,
  subject TEXT, body TEXT, snippet TEXT,
  msg_date TEXT, uid TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);`);
db.exec(`CREATE TABLE IF NOT EXISTS day_notes (day TEXT PRIMARY KEY, body TEXT, updated_at TEXT);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_lead ON emails(lead_id);`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_uid ON emails(uid) WHERE uid IS NOT NULL;`);
for (const col of ["offer_sent_at TEXT", "offer_amount REAL", "active INTEGER DEFAULT 1",
  "mao REAL", "equity REAL", "opportunity_score INTEGER", "assessed_value REAL", "last_sale_price REAL", "uw_at TEXT",
  "skiptraced_at TEXT", "skiptrace_raw TEXT", "fee_collected REAL", "fee_collected_at TEXT",
  "rent_estimate REAL", "latitude REAL", "longitude REAL", "comps_json TEXT", "arv_source TEXT"]) {
  try { db.exec(`ALTER TABLE leads ADD COLUMN ${col}`); } catch { /* already exists */ }
}
// One-time: bulk-pulled records (code violations / imported lists) start as Prospects, not active leads.
if (!db.prepare("SELECT value FROM settings WHERE key='migrated_active_v1'").get()) {
  db.prepare("UPDATE leads SET active=0 WHERE source='Detroit code violations' OR source LIKE '% list'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('migrated_active_v1', '1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
}

const now = () => new Date().toISOString();

// ---------- Settings (key/value) ----------
const getSetting = (k) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
  return row ? row.value : null;
};
const setSetting = (k, v) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v ?? "");

// Seed a couple of starter templates on first run.
if (db.prepare("SELECT COUNT(*) n FROM templates").get().n === 0) {
  const seed = db.prepare("INSERT INTO templates (created_at, name, subject, body, audience) VALUES (?,?,?,?,?)");
  seed.run(now(), "Cold seller — first touch", "Quick question about {{address}}",
    "Hi {{first_name}},\n\nMy name is {{my_name}} — I'm a local real estate investor and I came across your property at {{address}}{{city_clause}}. I'm interested in possibly buying it, as-is, and can be flexible on timing and terms.\n\nWould you be open to a quick chat about what you'd want for it? No pressure at all.\n\nThanks,\n{{my_name}}\n{{my_phone}}", "leads");
  seed.run(now(), "Seller follow-up", "Following up — {{address}}",
    "Hi {{first_name}},\n\nJust circling back on my note about {{address}}. I'm still interested and happy to work around whatever timeline makes sense for you.\n\nIs now a good time to talk? Even a quick text works: {{my_phone}}.\n\nBest,\n{{my_name}}", "leads");
  seed.run(now(), "Buyer blast — new deal", "New deal {{city_clause}} — assignment available",
    "Hey {{first_name}},\n\nGot a new one that might fit your buy box:\n\n📍 {{address}}\nARV: {{arv}}\nRepairs (est): {{repair_estimate}}\nAsking: {{contract_price}}\n\nSerious buyers only — first come first served. Reply or call {{my_phone}} if you want the full numbers and access.\n\n{{my_name}}", "buyers");
}
// Seed a default offer template (separate audience) if none exists yet.
if (db.prepare("SELECT COUNT(*) n FROM templates WHERE audience='offer'").get().n === 0) {
  db.prepare("INSERT INTO templates (created_at, name, subject, body, audience) VALUES (?,?,?,?,?)")
    .run(now(), "Cash offer — listing agent", "Cash offer — {{address}}",
      "Hi {{first_name}},\n\nI'd like to submit a cash offer on {{address}}:\n\n• Purchase price: {{offer}}\n• Earnest money deposit: {{earnest}}, submitted 1 business day after the inspection period\n• Inspection period: {{inspection_days}} business days\n• Closing: {{close_days}} days or less, all cash, no financing contingency\n• Purchased as-is — no repairs requested\n\nI'm a serious cash buyer and can close on your timeline. If the number doesn't work, send me a counter — I'm flexible and easy to work with.\n\nThanks,\n{{my_name}}\n{{my_phone}}", "offer");
}

const LEAD_FIELDS = [
  "stage", "seller_name", "seller_phone", "seller_email",
  "address", "city", "state", "zip",
  "property_type", "beds", "baths", "sqft",
  "asking_price", "arv", "repair_estimate",
  "offer_amount", "contract_price", "assignment_fee", "fee_collected",
  "motivation", "source", "next_followup", "notes",
];
const BUYER_FIELDS = ["name", "phone", "email", "areas", "property_types", "max_price", "cash", "notes"];

function logActivity(leadId, type, body) {
  db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)")
    .run(leadId, now(), type, body);
}
// Moving a lead into an offer stage (e.g. you sent the offer from your phone) counts as an offer sent:
// stamp offer_sent_at so it hits the dashboard KPI and the Offers tab. Idempotent.
const OFFER_STAGES = new Set(["Offer Made", "Backup Offer"]);
function markOfferSentIfNeeded(leadId, newStage) {
  if (!OFFER_STAGES.has(newStage)) return;
  const row = db.prepare("SELECT offer_sent_at FROM leads WHERE id=?").get(leadId);
  if (row && !row.offer_sent_at) {
    db.prepare("UPDATE leads SET offer_sent_at=? WHERE id=?").run(now(), leadId);
    logActivity(leadId, "note", `💵 Counted as offer sent (moved to ${newStage})`);
  }
}

// ---------- App ----------
const app = express();
app.use(express.json());
// No caching of static assets — this is a local app under active development,
// so the browser should always load the latest HTML/JS/CSS.
app.use(express.static(join(__dirname, "public"), {
  etag: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store, max-age=0"),
}));

// --- Leads ---
app.get("/api/leads", (req, res) => {
  const rows = db.prepare("SELECT * FROM leads WHERE active=1 ORDER BY updated_at DESC").all();
  res.json(rows);
});

// Prospects = raw pulled records awaiting your review (not yet active leads)
app.get("/api/prospects", (req, res) => {
  const rows = db.prepare("SELECT * FROM leads WHERE active=0 AND stage != 'Dead' ORDER BY created_at DESC").all();
  res.json(rows);
});
app.patch("/api/leads/:id/triage", (req, res) => {
  const action = req.body && req.body.action;
  if (action === "activate") db.prepare("UPDATE leads SET active=1, stage='New', updated_at=? WHERE id=?").run(now(), req.params.id);
  else if (action === "dismiss") db.prepare("UPDATE leads SET active=0, stage='Dead', updated_at=? WHERE id=?").run(now(), req.params.id);
  // Send an active working lead back to the review queue without killing it.
  else if (action === "review") db.prepare("UPDATE leads SET active=0, stage=CASE WHEN stage='Dead' THEN 'New' ELSE stage END, updated_at=? WHERE id=?").run(now(), req.params.id);
  else return res.status(400).json({ error: "bad action" });
  res.json({ ok: true });
});

app.get("/api/leads/:id", (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  lead.activities = db
    .prepare("SELECT * FROM activities WHERE lead_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json(lead);
});

// Auto-pull Detroit code-violation leads from the city's open data (free, official).
const DETROIT_BLIGHT = "https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/blight_tickets/FeatureServer/0/query";
async function pullBlightTickets(days, max = 2000) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = []; let offset = 0; const page = 1000;
  while (out.length < max) {
    const u = new URL(DETROIT_BLIGHT);
    const params = {
      where: `ticket_issued_date >= DATE '${since}'`,
      outFields: "address,zip_code,property_owner_name,property_owner_address,property_owner_city,property_owner_state,property_owner_zip_code,ordinance_description,ticket_issued_date,amt_balance_due",
      orderByFields: "ticket_issued_date DESC", resultRecordCount: String(page), resultOffset: String(offset), f: "json",
    };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u);
    const j = await r.json();
    const feats = j.features || [];
    if (!feats.length) break;
    out.push(...feats.map((f) => f.attributes));
    if (feats.length < page) break;
    offset += page;
  }
  return out.slice(0, max);
}
app.post("/api/leads/pull-violations", async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.body && req.body.days) || 30));
  try {
    const tickets = await pullBlightTickets(days);
    const t = now(); const seen = new Set(); let imported = 0, skipped = 0;
    const ins = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, active, seller_name, address, city, state, zip, motivation, source, notes)
        VALUES (?, ?, 'New', 0, ?, ?, 'Detroit', 'MI', ?, 'Code violation', 'Detroit code violations', ?)`);
    for (const a of tickets) {
      const addr = (a.address || "").trim();
      if (!addr) { skipped++; continue; }
      const full = `${addr}, Detroit, MI ${a.zip_code || ""}`.trim();
      const key = full.toLowerCase();
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      if (db.prepare("SELECT id FROM leads WHERE lower(address)=lower(?)").get(full)) { skipped++; continue; }
      const ownStreet = (a.property_owner_address || "").toUpperCase().replace(/\s+/g, " ").trim();
      const absentee = ownStreet && ownStreet !== addr.toUpperCase().replace(/\s+/g, " ").trim();
      const mailing = [a.property_owner_address, a.property_owner_city, a.property_owner_state, a.property_owner_zip_code].filter(Boolean).join(", ");
      const notes = `Code violation: ${a.ordinance_description || "n/a"}\nTicket issued: ${a.ticket_issued_date || ""}${a.amt_balance_due ? " · balance due $" + a.amt_balance_due : ""}\nOwner mailing: ${mailing || "n/a"}${absentee ? "  ⚑ ABSENTEE (owner lives elsewhere)" : ""}`;
      ins.run(t, t, a.property_owner_name || null, full, a.zip_code || null, notes);
      imported++;
    }
    res.json({ found: tickets.length, imported, skipped });
  } catch (err) {
    res.status(500).json({ error: "Couldn't pull Detroit data: " + String(err.message || err) });
  }
});

// ---- Free underwriting from Detroit's parcel file (assessed value, last sale, sqft) ----
const DETROIT_PARCELS = "https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/parcel_file_current/FeatureServer/0/query";
// Detroit's parcel file stores street addresses WITHOUT the street-type suffix ("13335 STRATHMOOR",
// not "13335 STRATHMOOR ST"). Normalize so leads match: take the street part, drop a trailing suffix.
const ST_SUFFIX = new Set("ST STREET AVE AV AVENUE RD ROAD DR DRIVE BLVD BOULEVARD LN LANE CT COURT PL PLACE WAY TER TERR TERRACE CIR CIRCLE PKWY PARKWAY HWY HIGHWAY SQ SQUARE ROW PT POINT PLZ PLAZA CRES".split(" "));
const streetOf = (addr) => {
  const parts = (addr || "").split(",")[0].trim().toUpperCase().replace(/\s+/g, " ").split(" ");
  if (parts.length > 2 && ST_SUFFIX.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
};
async function lookupParcels(addresses) {
  const map = {};
  const uniq = [...new Set(addresses.filter(Boolean))];
  const chunk = 60;
  for (let i = 0; i < uniq.length; i += chunk) {
    const inClause = uniq.slice(i, i + chunk).map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
    const u = new URL(DETROIT_PARCELS);
    u.searchParams.set("where", `address IN (${inClause})`);
    u.searchParams.set("outFields", "address,amt_assessed_value,amt_sale_price,total_floor_area,total_square_footage,year_built");
    u.searchParams.set("f", "json");
    try {
      const r = await fetch(u); const j = await r.json();
      for (const f of (j.features || [])) { const a = f.attributes; if (a.address && !map[a.address]) map[a.address] = a; }
    } catch { /* skip chunk on error */ }
  }
  return map;
}
// Build FREE live comps from Detroit's recorded parcel sales: nearby recent arms-length sales
// of similar-size homes → median $/sqft → ARV. Real closed prices, no paid API.
async function detroitComps(address) {
  const street = streetOf(address);
  if (!street) return null;
  try {
    // 1) subject parcel: centroid (Web Mercator) + building floor area
    const su = new URL(DETROIT_PARCELS);
    su.searchParams.set("where", `address='${street.replace(/'/g, "''")}'`);
    su.searchParams.set("outFields", "address,total_floor_area,year_built");
    su.searchParams.set("returnCentroid", "true");
    su.searchParams.set("returnGeometry", "false");
    su.searchParams.set("outSR", "3857");
    su.searchParams.set("f", "json");
    const sj = await (await fetch(su)).json();
    const feat = (sj.features || [])[0];
    if (!feat || !feat.centroid) return null;
    const { x, y } = feat.centroid;
    const subjSqft = feat.attributes.total_floor_area || 0;
    if (!subjSqft) return { subjSqft: 0, arv: null, comps: [], count: 0 };
    // 2) nearby comparable recent sales (~0.75mi, similar sqft, last 2 yrs, sane price band)
    const lo = Math.round(subjSqft * 0.6), hi = Math.round(subjSqft * 1.6);
    const cutoff = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
    const cu = new URL(DETROIT_PARCELS);
    cu.searchParams.set("geometry", `${x},${y}`);
    cu.searchParams.set("geometryType", "esriGeometryPoint");
    cu.searchParams.set("inSR", "3857");
    cu.searchParams.set("distance", "1200");
    cu.searchParams.set("units", "esriSRUnit_Meter");
    cu.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    cu.searchParams.set("where", `amt_sale_price>=8000 AND amt_sale_price<=400000 AND total_floor_area>=${lo} AND total_floor_area<=${hi} AND sale_date>=DATE '${cutoff}'`);
    cu.searchParams.set("outFields", "address,amt_sale_price,sale_date,total_floor_area");
    cu.searchParams.set("returnGeometry", "false");
    cu.searchParams.set("orderByFields", "sale_date DESC");
    cu.searchParams.set("resultRecordCount", "60");
    cu.searchParams.set("f", "json");
    const cj = await (await fetch(cu)).json();
    let comps = (cj.features || []).map((f) => f.attributes)
      .filter((a) => a.total_floor_area > 0 && a.amt_sale_price > 0 && streetOf(a.address) !== street)
      .map((a) => ({ address: a.address, price: Math.round(a.amt_sale_price), sqft: a.total_floor_area, date: a.sale_date, ppsf: a.amt_sale_price / a.total_floor_area }));
    if (!comps.length) return { subjSqft, arv: null, comps: [], count: 0 };
    const ppsfs = comps.map((c) => c.ppsf).sort((a, b) => a - b);
    const med = ppsfs[Math.floor(ppsfs.length / 2)];
    const arv = Math.round(med * subjSqft);
    const display = [...comps].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 6)
      .map((c) => ({ address: c.address, price: c.price, sqft: c.sqft, date: c.date }));
    return { subjSqft, medPpsf: Math.round(med), arv, count: comps.length, comps: display };
  } catch { return null; }
}

// Run the wholesale math for one lead. Prefers a comps-based ARV, falls back to assessed×2.
function computeUnderwrite(lead, a, cfg, compsArv) {
  const assessed = a.amt_assessed_value || 0;
  const useComps = compsArv && compsArv > 0;
  const arv = useComps ? Math.round(compsArv) : Math.round(assessed * 2); // MI assesses at ~50% of market
  const arvSource = useComps ? "comps" : "assessed";
  const floor = a.total_floor_area || a.total_square_footage || 0;
  const repairs = Math.round(floor * cfg.rehabPerSqft);
  const mao = Math.round(arv * (cfg.buyerPct / 100) - repairs - cfg.minFee);
  const lastSale = a.amt_sale_price || 0;
  const equity = Math.round(arv - lastSale);
  const absentee = (lead.notes || "").includes("ABSENTEE");
  let score = 0;
  if (arv > 0) {
    if (mao > 0) score += Math.min(50, mao / 1000);
    if (absentee) score += 20;
    if (equity > 0) score += Math.min(30, equity / 2000);
  }
  score = Math.round(Math.max(0, Math.min(100, score)));
  return { arv, repairs, mao, equity, score, assessed, lastSale, arvSource };
}
const UW_UPDATE = `UPDATE leads SET arv=?, repair_estimate=?, mao=?, equity=?, opportunity_score=?,
    assessed_value=?, last_sale_price=?, arv_source=?, uw_at=?, updated_at=? WHERE id=?`;

// Full single-lead underwrite WITH free live comps (used on lead-add and on-demand).
async function underwriteOne(leadId, cfg) {
  const lead = db.prepare("SELECT id, address, notes FROM leads WHERE id=?").get(leadId);
  if (!lead || !lead.address) return { matched: false };
  const map = await lookupParcels([streetOf(lead.address)]);
  const a = map[streetOf(lead.address)];
  if (!a) return { matched: false };
  let compsData = null, compsArv = null;
  try { compsData = await detroitComps(lead.address); if (compsData && compsData.arv) compsArv = compsData.arv; } catch { /* comps optional */ }
  const u = computeUnderwrite(lead, a, cfg, compsArv);
  const t = now();
  db.prepare(`UPDATE leads SET arv=?, repair_estimate=?, mao=?, equity=?, opportunity_score=?,
      assessed_value=?, last_sale_price=?, arv_source=?, comps_json=?, uw_at=?, updated_at=? WHERE id=?`)
    .run(u.arv, u.repairs, u.mao, u.equity, u.score, u.assessed, u.lastSale, u.arvSource,
      compsData ? JSON.stringify(compsData) : null, t, t, leadId);
  return { matched: true, ...u, comps: compsData };
}

// Bulk underwrite every non-dead record (prospects AND active leads).
app.post("/api/prospects/underwrite", async (req, res) => {
  const props = db.prepare("SELECT id, address, notes FROM leads WHERE stage != 'Dead'").all();
  const cfg = acqConfig();
  try {
    const map = await lookupParcels(props.map((p) => streetOf(p.address)));
    const t = now(); let underwritten = 0;
    const upd = db.prepare(UW_UPDATE);
    for (const p of props) {
      const a = map[streetOf(p.address)];
      if (!a) continue;
      const u = computeUnderwrite(p, a, cfg);
      upd.run(u.arv, u.repairs, u.mao, u.equity, u.score, u.assessed, u.lastSale, u.arvSource, t, t, p.id);
      underwritten++;
    }
    res.json({ total: props.length, underwritten });
  } catch (err) {
    res.status(500).json({ error: "Underwriting failed: " + String(err.message || err) });
  }
});

// Underwrite ONE lead on demand WITH free live comps — works for active leads or prospects.
app.post("/api/leads/:id/underwrite", async (req, res) => {
  const lead = db.prepare("SELECT id, address FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!lead.address) return res.status(400).json({ error: "This lead has no address to cross-reference." });
  try {
    const r = await underwriteOne(lead.id, acqConfig());
    if (!r.matched) return res.status(404).json({ error: "No Detroit parcel record matched this address. (Comps & underwriting use Detroit's free parcel file — Detroit addresses only.)" });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ error: "Underwriting failed: " + String(err.message || err) });
  }
});
// Just the comps for a lead (free recorded sales), without re-underwriting.
app.get("/api/leads/:id/comps", async (req, res) => {
  const lead = db.prepare("SELECT id, address, comps_json FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  if (lead.comps_json) { try { return res.json(JSON.parse(lead.comps_json)); } catch {} }
  try {
    const c = await detroitComps(lead.address);
    if (c) db.prepare("UPDATE leads SET comps_json=? WHERE id=?").run(JSON.stringify(c), lead.id);
    res.json(c || { arv: null, comps: [], count: 0 });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// ---- Skip tracing (BatchData) — pull owner phone/email for any lead, any status ----
function parseAddr(addr) {
  // "16133 STEEL, Detroit, MI 48235" -> {street, city, state, zip}
  const parts = (addr || "").split(",").map((s) => s.trim()).filter(Boolean);
  const out = { street: parts[0] || "", city: parts[1] || "Detroit", state: "MI", zip: "" };
  const tail = parts[2] || "";
  const m = tail.match(/([A-Za-z]{2})\s*(\d{5})?/);
  if (m) { out.state = m[1].toUpperCase(); if (m[2]) out.zip = m[2]; }
  return out;
}
// Defensively walk any JSON shape and collect phone-like and email-like values.
function collectContacts(obj, found = { phones: [], emails: [] }) {
  if (obj == null) return found;
  if (typeof obj === "string") {
    const digits = obj.replace(/[^\d]/g, "");
    if (/@/.test(obj) && /\.[a-z]{2,}/i.test(obj)) { if (!found.emails.includes(obj)) found.emails.push(obj); }
    else if (digits.length >= 10 && digits.length <= 11) { const p = digits.slice(-10); if (!found.phones.includes(p)) found.phones.push(p); }
    return found;
  }
  if (Array.isArray(obj)) { for (const v of obj) collectContacts(v, found); return found; }
  if (typeof obj === "object") { for (const k in obj) collectContacts(obj[k], found); return found; }
  return found;
}
const fmtPhone = (p) => (p && p.length === 10) ? `(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}` : p;

app.post("/api/leads/:id/skiptrace", async (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const key = getSetting("batchdata_api_key") || process.env.BATCHDATA_API_KEY;
  if (!key) return res.status(400).json({ error: "Connect BatchData first (Acquisitions → Connect skip tracing)." });
  if (!lead.address) return res.status(400).json({ error: "This lead has no address to skip trace." });
  const ad = parseAddr(lead.address);
  try {
    const r = await fetch("https://api.batchdata.com/api/v1/property/skip-trace", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ requests: [ { propertyAddress: { street: ad.street, city: ad.city, state: ad.state, zip: ad.zip } } ] }),
    });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!r.ok) {
      const msg = (j && (j.message || (j.status && j.status.message))) || `Skip trace failed (HTTP ${r.status})`;
      return res.status(r.status === 401 ? 400 : 502).json({ error: r.status === 401 ? "BatchData rejected the key — check it in Acquisitions." : msg });
    }
    const { phones, emails } = collectContacts(j);
    const phone = phones[0] ? fmtPhone(phones[0]) : null;
    const email = emails[0] || null;
    const t = now();
    db.prepare(`UPDATE leads SET seller_phone=COALESCE(NULLIF(?,''), seller_phone),
        seller_email=COALESCE(NULLIF(?,''), seller_email), skiptraced_at=?, skiptrace_raw=?, updated_at=? WHERE id=?`)
      .run(phone || "", email || "", t, JSON.stringify({ phones, emails }), t, lead.id);
    db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?, ?, 'skiptrace', ?)")
      .run(lead.id, t, `Skip traced — ${phones.length} phone(s), ${emails.length} email(s) found.`);
    res.json({ ok: true, phones: phones.map(fmtPhone), emails, phone, email });
  } catch (err) {
    res.status(502).json({ error: "Skip trace error: " + String(err.message || err) });
  }
});

// Bulk-import leads from a parsed CSV list (tax-delinquent, code violations, probate, D4D).
app.post("/api/leads/import", (req, res) => {
  const rows = (req.body && req.body.leads) || [];
  const source = (req.body && req.body.source) || "Imported list";
  const motivation = (req.body && req.body.motivation) || null;
  const t = now();
  let imported = 0, skipped = 0;
  const ins = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, active, seller_name, seller_phone, seller_email, address, city, state, zip, motivation, source, notes)
      VALUES (?, ?, 'New', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    const addr = (r.address || "").trim();
    const name = (r.seller_name || "").trim();
    if (!addr && !name) { skipped++; continue; }
    if (addr && db.prepare("SELECT id FROM leads WHERE lower(address)=lower(?)").get(addr)) { skipped++; continue; }
    ins.run(t, t, name || null, (r.seller_phone || "").trim() || null, (r.seller_email || "").trim() || null,
      addr || null, (r.city || "").trim() || null, (r.state || "").trim() || null, (r.zip || "").trim() || null,
      motivation, source, (r.notes || "").trim() || null);
    imported++;
  }
  res.json({ imported, skipped });
});

app.post("/api/leads", async (req, res) => {
  const b = req.body || {};
  if (!b.stage) b.stage = "New"; // stage is NOT NULL
  // Guard against double-submit: same address created in the last 15s → return the existing lead.
  if (b.address && b.address.trim()) {
    const recent = db.prepare("SELECT id FROM leads WHERE lower(address)=lower(?) AND created_at > ?")
      .get(b.address.trim(), new Date(Date.now() - 15000).toISOString());
    if (recent) return res.json({ id: recent.id, duplicate: true });
  }
  const t = now();
  const info = db
    .prepare(`INSERT INTO leads (created_at, updated_at, ${LEAD_FIELDS.join(",")})
              VALUES (?, ?, ${LEAD_FIELDS.map(() => "?").join(",")})`)
    .run(t, t, ...LEAD_FIELDS.map((f) => (b[f] === undefined || b[f] === "" ? null : b[f])));
  const id = info.lastInsertRowid;
  logActivity(id, "stage_change", `Lead created — stage: ${b.stage || "New"}`);
  // Auto-load free analysis (comps → ARV, underwrite, score) so the lead comes pre-filled — no buttons.
  let uw = null;
  if (b.address) { try { uw = await underwriteOne(id, acqConfig()); } catch { /* non-fatal */ } }
  res.json({ id, underwrite: uw && uw.matched ? uw : null });
});

app.put("/api/leads/:id", (req, res) => {
  const b = req.body || {};
  const existing = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not found" });
  if (!b.stage) b.stage = existing.stage; // never null out the stage
  db.prepare(`UPDATE leads SET updated_at = ?, ${LEAD_FIELDS.map((f) => `${f} = ?`).join(",")} WHERE id = ?`)
    .run(now(), ...LEAD_FIELDS.map((f) => (b[f] === undefined || b[f] === "" ? null : b[f])), req.params.id);
  if (b.stage && b.stage !== existing.stage) {
    logActivity(req.params.id, "stage_change", `Stage: ${existing.stage} → ${b.stage}`);
    markOfferSentIfNeeded(req.params.id, b.stage);
  }
  res.json({ ok: true });
});

app.delete("/api/leads/:id", (req, res) => {
  db.prepare("DELETE FROM activities WHERE lead_id = ?").run(req.params.id);
  db.prepare("DELETE FROM tasks WHERE lead_id = ?").run(req.params.id);
  // Free any imported property so it can be re-imported from the Acquisitions feed.
  db.prepare("UPDATE properties SET imported_lead_id = NULL, review_status = 'New' WHERE imported_lead_id = ?").run(req.params.id);
  db.prepare("DELETE FROM leads WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Create a follow-up (task + dashboard reminder) for a lead, on demand.
app.post("/api/leads/:id/followup", (req, res) => {
  const lead = db.prepare("SELECT id FROM leads WHERE id = ?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  const days = Math.max(1, Number(req.body && req.body.days) || 3);
  const due = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  db.prepare("INSERT INTO tasks (lead_id, created_at, title, due_date, done) VALUES (?,?,?,?,0)")
    .run(req.params.id, now(), "Follow up", due);
  db.prepare("UPDATE leads SET next_followup = ?, updated_at = ? WHERE id = ?").run(due, now(), req.params.id);
  res.json({ ok: true, due });
});

// --- Activities ---
app.post("/api/leads/:id/activities", (req, res) => {
  const { type, body } = req.body || {};
  logActivity(req.params.id, type || "note", body || "");
  db.prepare("UPDATE leads SET updated_at = ? WHERE id = ?").run(now(), req.params.id);
  res.json({ ok: true });
});

// --- Quick stage change (for the drag-and-drop board) ---
app.patch("/api/leads/:id/stage", (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: "stage required" });
  const existing = db.prepare("SELECT stage FROM leads WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not found" });
  db.prepare("UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?").run(stage, now(), req.params.id);
  if (stage !== existing.stage) {
    logActivity(req.params.id, "stage_change", `Stage: ${existing.stage} → ${stage}`);
    markOfferSentIfNeeded(req.params.id, stage);
  }
  res.json({ ok: true });
});

// --- Tasks / reminders ---
app.get("/api/tasks", (req, res) => {
  // Open tasks joined with their lead, soonest due first (no-date last).
  const rows = db.prepare(`
    SELECT t.*, l.seller_name, l.address, l.stage
    FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
    WHERE t.done = 0
    ORDER BY (t.due_date IS NULL), t.due_date ASC, t.created_at ASC
  `).all();
  res.json(rows);
});
app.post("/api/leads/:id/tasks", (req, res) => {
  const { title, due_date } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const lid = req.params.id === "none" ? null : req.params.id;
  const info = db.prepare("INSERT INTO tasks (lead_id, created_at, title, due_date, done) VALUES (?,?,?,?,0)")
    .run(lid, now(), title, due_date || null);
  res.json({ id: info.lastInsertRowid });
});
app.get("/api/leads/:id/tasks", (req, res) => {
  res.json(db.prepare("SELECT * FROM tasks WHERE lead_id = ? ORDER BY done, (due_date IS NULL), due_date").all(req.params.id));
});
app.put("/api/tasks/:id", (req, res) => {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  const b = req.body || {};
  db.prepare("UPDATE tasks SET title = ?, due_date = ?, done = ? WHERE id = ?")
    .run(b.title ?? t.title, b.due_date !== undefined ? b.due_date : t.due_date, b.done !== undefined ? (b.done ? 1 : 0) : t.done, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/tasks/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Email config (DB settings preferred, .env as fallback) ---
function emailCfg() {
  return {
    user: getSetting("gmail_user") || process.env.GMAIL_USER || "",
    pass: getSetting("gmail_app_password") || process.env.GMAIL_APP_PASSWORD || "",
    fromName: getSetting("from_name") || process.env.GMAIL_FROM_NAME || "",
    myName: getSetting("my_name") || "",
    myPhone: getSetting("my_phone") || "",
  };
}
function emailConfigured() {
  const c = emailCfg();
  return Boolean(c.user && c.pass);
}
function makeTransport() {
  const c = emailCfg();
  return nodemailer.createTransport({ service: "gmail", auth: { user: c.user, pass: c.pass } });
}
function fromHeader() {
  const c = emailCfg();
  return c.fromName ? `${c.fromName} <${c.user}>` : c.user;
}
const fmtMoney = (n) => (n || n === 0) && !isNaN(n) ? "$" + Number(n).toLocaleString() : "";

// Replace {{merge_fields}} in a string using a lead/buyer row + my own info.
function mergeFields(str, row = {}) {
  const c = emailCfg();
  const name = row.seller_name || row.name || "";
  const first = (name || "there").trim().split(/\s+/)[0] || "there";
  const map = {
    first_name: first,
    seller_name: name,
    name: name,
    address: row.address || "your property",
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
    city_clause: row.city ? ` in ${row.city}` : "",
    arv: fmtMoney(row.arv),
    repair_estimate: fmtMoney(row.repair_estimate),
    contract_price: fmtMoney(row.contract_price),
    asking_price: fmtMoney(row.asking_price),
    assignment_fee: fmtMoney(row.assignment_fee),
    my_name: c.myName || c.fromName || "",
    my_phone: c.myPhone || "",
  };
  return (str || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}

async function sendOne(transporter, to, subject, body) {
  await transporter.sendMail({ from: fromHeader(), to, subject, text: body, html: body.replace(/\n/g, "<br>") });
}

// Store an email in the unified log (used by both inbound sync and outbound send).
function recordEmail({ lead_id = null, direction, from_name = "", from_addr = "", to_addr = "", subject = "", body = "", msg_date = null, uid = null, read = 0 }) {
  const snippet = (body || "").replace(/\s+/g, " ").trim().slice(0, 200);
  try {
    db.prepare(`INSERT INTO emails (lead_id, direction, from_name, from_addr, to_addr, subject, body, snippet, msg_date, uid, read, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(lead_id, direction, from_name, from_addr, to_addr, subject, body, snippet, msg_date || now(), uid, read, now());
    return true;
  } catch { return false; /* duplicate uid */ }
}
// Find the lead that owns an email address (so inbound replies thread to the deal).
function leadByEmail(addr) {
  if (!addr) return null;
  return db.prepare("SELECT id, address, seller_name FROM leads WHERE lower(seller_email)=lower(?)").get(addr) || null;
}

// Append the saved footer/signature (address + unsubscribe line) to an email body.
function withFooter(body) {
  const f = getSetting("email_footer");
  return f && f.trim() ? `${body}\n\n--\n${f.trim()}` : body;
}

app.get("/api/settings", (req, res) => {
  const c = emailCfg();
  res.json({
    emailConfigured: emailConfigured(),
    gmailUser: c.user || null,
    fromName: c.fromName || "",
    myName: c.myName || "",
    myPhone: c.myPhone || "",
    emailFooter: getSetting("email_footer") || "",
    hasPassword: Boolean(c.pass),
  });
});

app.post("/api/settings", (req, res) => {
  const b = req.body || {};
  if (b.gmail_user !== undefined) setSetting("gmail_user", b.gmail_user.trim());
  if (b.from_name !== undefined) setSetting("from_name", b.from_name);
  if (b.my_name !== undefined) setSetting("my_name", b.my_name);
  if (b.my_phone !== undefined) setSetting("my_phone", b.my_phone);
  if (b.email_footer !== undefined) setSetting("email_footer", b.email_footer);
  // Only overwrite the password when a non-empty one is supplied (keeps it on partial saves).
  if (b.gmail_app_password) setSetting("gmail_app_password", b.gmail_app_password.replace(/\s+/g, ""));
  res.json({ ok: true, emailConfigured: emailConfigured() });
});

app.post("/api/test-email", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail first." });
  const c = emailCfg();
  const to = (req.body && req.body.to) || c.user;
  try {
    await sendOne(makeTransport(), to, "✅ Test from your Wholesale CRM",
      withFooter(`Nice — your email is connected.\n\nThis test was sent from your CRM as ${fromHeader()}.\nYou're ready to send outreach.\n\n(The text below your name is your saved footer — it appears on every email.)`));
    res.json({ ok: true, to });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/leads/:id/email", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail in the Outreach tab first." });
  const { to, subject } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "Missing recipient or subject" });
  const rawBody = (req.body && req.body.body) || "";
  const body = withFooter(rawBody);
  try {
    await sendOne(makeTransport(), to, subject, body);
    logActivity(req.params.id, "email", `📧 Sent to ${to}\nSubject: ${subject}\n\n${body}`);
    recordEmail({ lead_id: req.params.id, direction: "out", from_name: emailCfg().fromName, from_addr: emailCfg().user, to_addr: to, subject, body: rawBody });
    db.prepare("UPDATE leads SET updated_at = ? WHERE id = ?").run(now(), req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Daily notes (calendar) ---
app.get("/api/day-notes", (req, res) => {
  res.json(db.prepare("SELECT day, body, updated_at FROM day_notes WHERE body IS NOT NULL AND body != '' ORDER BY day ASC").all());
});
app.get("/api/day-notes/:day", (req, res) => {
  const row = db.prepare("SELECT day, body, updated_at FROM day_notes WHERE day=?").get(req.params.day);
  res.json(row || { day: req.params.day, body: "" });
});
app.put("/api/day-notes/:day", (req, res) => {
  const body = ((req.body && req.body.body) || "").trim();
  if (!body) { db.prepare("DELETE FROM day_notes WHERE day=?").run(req.params.day); return res.json({ ok: true, deleted: true }); }
  db.prepare(`INSERT INTO day_notes (day, body, updated_at) VALUES (?,?,?)
    ON CONFLICT(day) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`).run(req.params.day, body, now());
  res.json({ ok: true });
});

// Recent messages across all leads (for the dashboard panel) — newest first.
app.get("/api/emails/recent", (req, res) => {
  const rows = db.prepare(`SELECT e.id, e.lead_id AS leadId, e.direction, e.from_name AS fromName, e.from_addr AS fromEmail,
      e.to_addr AS toAddr, e.subject, e.snippet, e.msg_date AS date, e.read,
      l.address AS leadAddr, l.seller_name AS leadSeller
    FROM emails e JOIN leads l ON l.id = e.lead_id
    ORDER BY e.msg_date DESC LIMIT 6`).all();
  for (const m of rows) m.leadName = m.leadAddr || m.leadSeller || null;
  res.json({ messages: rows });
});

// Conversation thread for a lead — inbound + outbound, oldest first.
app.get("/api/leads/:id/thread", (req, res) => {
  const rows = db.prepare("SELECT id, direction, from_name, from_addr, to_addr, subject, body, snippet, msg_date, read FROM emails WHERE lead_id=? ORDER BY msg_date ASC").all(req.params.id);
  db.prepare("UPDATE emails SET read=1 WHERE lead_id=? AND direction='in'").run(req.params.id);
  res.json({ messages: rows });
});

// Generic send (used by Inbox reply). Threads to a lead if one matches the recipient.
app.post("/api/email/send", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail in the Outreach tab first." });
  const { to, subject } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "Missing recipient or subject" });
  const rawBody = (req.body && req.body.body) || "";
  const body = withFooter(rawBody);
  const lead = leadByEmail(to);
  try {
    await sendOne(makeTransport(), to, subject, body);
    recordEmail({ lead_id: lead ? lead.id : null, direction: "out", from_name: emailCfg().fromName, from_addr: emailCfg().user, to_addr: to, subject, body: rawBody });
    if (lead) { logActivity(lead.id, "email", `📧 Sent to ${to}\nSubject: ${subject}\n\n${body}`); db.prepare("UPDATE leads SET updated_at=? WHERE id=?").run(now(), lead.id); }
    res.json({ ok: true, leadId: lead ? lead.id : null });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Send an offer to the listing agent + flag the lead ---
app.post("/api/leads/:id/offer", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail in the Outreach tab first." });
  const lead = db.prepare("SELECT id, stage FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  const { to, subject, offerAmount } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "Missing recipient or subject" });
  const body = withFooter((req.body && req.body.body) || "");
  try {
    await sendOne(makeTransport(), to, subject, body);
    const amt = Number(offerAmount) || null;
    logActivity(req.params.id, "email", `💵 Offer sent to ${to}${amt ? " — $" + amt.toLocaleString() : ""}\nSubject: ${subject}\n\n${body}`);
    recordEmail({ lead_id: req.params.id, direction: "out", from_name: emailCfg().fromName, from_addr: emailCfg().user, to_addr: to, subject, body: (req.body && req.body.body) || "" });
    // Advance the pipeline to "Offer Made" (unless it's already further along).
    const beforeOffer = ["New", "Contacted", "Follow-Up"];
    let stage = lead.stage;
    if (beforeOffer.includes(lead.stage)) {
      stage = "Offer Made";
      logActivity(req.params.id, "stage_change", `Stage: ${lead.stage} → Offer Made (offer sent)`);
    }
    db.prepare("UPDATE leads SET offer_sent_at=?, offer_amount=?, stage=?, updated_at=? WHERE id=?").run(now(), amt, stage, now(), req.params.id);
    res.json({ ok: true, stage });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Inbox: serve cached inbound email instantly from the DB ---
app.get("/api/inbox", (req, res) => {
  const rows = db.prepare(`SELECT e.id, e.lead_id AS leadId, e.from_name AS fromName, e.from_addr AS fromEmail,
      e.subject, e.body, e.snippet, e.msg_date AS date, e.read,
      l.address AS leadAddr, l.seller_name AS leadSeller
    FROM emails e LEFT JOIN leads l ON l.id = e.lead_id
    WHERE e.direction='in' ORDER BY e.msg_date DESC LIMIT 100`).all();
  for (const m of rows) m.leadName = m.leadAddr || m.leadSeller || null;
  const unread = db.prepare("SELECT COUNT(*) c FROM emails WHERE direction='in' AND read=0").get().c;
  res.json({ messages: rows, unread, syncedAt: getSetting("inbox_synced_at") || null });
});

// --- Inbox sync: pull new mail over IMAP into the cache (the slow part, on demand) ---
// Pull new inbound mail over IMAP into the cache. Throws on failure; returns count added.
async function syncInboxOnce() {
  const c = emailCfg();
  if (!c.user || !c.pass) throw new Error("Gmail not connected");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false });
  let added = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox.exists || 0;
      if (total > 0) {
        const start = Math.max(1, total - 49); // last 50
        for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: true })) {
          const uid = String(msg.uid);
          if (db.prepare("SELECT 1 FROM emails WHERE uid=?").get(uid)) continue;
          let text = "";
          try { text = (await simpleParser(msg.source)).text || ""; } catch { /* ignore parse errors */ }
          const from = msg.envelope.from && msg.envelope.from[0];
          const fromEmail = (from && from.address) || "";
          const lead = leadByEmail(fromEmail);
          const ok = recordEmail({
            lead_id: lead ? lead.id : null, direction: "in",
            from_name: (from && from.name) || "", from_addr: fromEmail, to_addr: c.user,
            subject: msg.envelope.subject || "(no subject)", body: text.trim(),
            msg_date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : now(), uid,
          });
          if (ok) added++;
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    try { await client.close(); } catch {}
    throw err;
  }
  setSetting("inbox_synced_at", now());
  if (added > 0) db.prepare("INSERT INTO notifications (created_at, type, title, body, read) VALUES (?,?,?,?,0)")
    .run(now(), "inbox", `📥 ${added} new email${added === 1 ? "" : "s"}`, "New mail landed in your inbox.");
  return added;
}
app.post("/api/inbox/sync", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail in the Outreach tab first." });
  try {
    const added = await syncInboxOnce();
    res.json({ ok: true, added });
  } catch (err) {
    res.status(500).json({ error: "Couldn't read inbox: " + String(err.message || err) + ". Make sure IMAP is enabled in Gmail (Settings → Forwarding and POP/IMAP)." });
  }
});
// Background auto-sync every 10 minutes (only runs once Gmail is connected).
let inboxSyncing = false;
async function autoSyncInbox() {
  if (inboxSyncing || !emailConfigured()) return;
  inboxSyncing = true;
  try { await syncInboxOnce(); }
  catch (e) { console.error("inbox auto-sync failed:", e.message); }
  finally { inboxSyncing = false; }
}
setInterval(autoSyncInbox, 10 * 60 * 1000); // every 10 minutes
setTimeout(autoSyncInbox, 15 * 1000); // and shortly after startup

// --- Templates ---
app.get("/api/templates", (req, res) => {
  res.json(db.prepare("SELECT * FROM templates ORDER BY audience, name").all());
});
app.post("/api/templates", (req, res) => {
  const { name, subject, body, audience } = req.body || {};
  const info = db.prepare("INSERT INTO templates (created_at, name, subject, body, audience) VALUES (?,?,?,?,?)")
    .run(now(), name || "Untitled", subject || "", body || "", audience || "leads");
  res.json({ id: info.lastInsertRowid });
});
app.put("/api/templates/:id", (req, res) => {
  const { name, subject, body, audience } = req.body || {};
  db.prepare("UPDATE templates SET name=?, subject=?, body=?, audience=? WHERE id=?")
    .run(name, subject, body, audience || "leads", req.params.id);
  res.json({ ok: true });
});
app.delete("/api/templates/:id", (req, res) => {
  db.prepare("DELETE FROM templates WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// --- Bulk outreach ---
app.post("/api/outreach", async (req, res) => {
  if (!emailConfigured()) return res.status(400).json({ error: "Connect your Gmail in the Outreach tab first." });
  const { subject, body, audience, ids } = req.body || {};
  if (!subject || !body) return res.status(400).json({ error: "Subject and body are required." });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "Pick at least one recipient." });

  const table = audience === "buyers" ? "buyers" : "leads";
  const transporter = makeTransport();
  const results = { sent: 0, skipped: 0, failed: 0, errors: [] };

  for (const id of ids) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    const to = row && (row.seller_email || row.email);
    if (!to) { results.skipped++; results.errors.push(`#${id}: no email on file`); continue; }
    try {
      const subj = mergeFields(subject, row);
      const text = withFooter(mergeFields(body, row));
      await sendOne(transporter, to, subj, text);
      results.sent++;
      if (table === "leads") {
        logActivity(id, "email", `📧 Outreach sent to ${to}\nSubject: ${subj}\n\n${text}`);
        db.prepare("UPDATE leads SET updated_at = ? WHERE id = ?").run(now(), id);
      }
      await new Promise((r) => setTimeout(r, 350)); // gentle throttle
    } catch (err) {
      results.failed++;
      results.errors.push(`${to}: ${String(err.message || err)}`);
    }
  }
  res.json(results);
});

// --- Outreach preview (no send) ---
app.post("/api/outreach/preview", (req, res) => {
  const { subject, body, audience, id } = req.body || {};
  const table = audience === "buyers" ? "buyers" : "leads";
  const row = id ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) : {};
  res.json({ subject: mergeFields(subject, row || {}), body: mergeFields(body, row || {}) });
});

// --- Buyers ---
app.get("/api/buyers", (req, res) => {
  res.json(db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all());
});

app.post("/api/buyers", (req, res) => {
  const b = req.body || {};
  const info = db
    .prepare(`INSERT INTO buyers (created_at, ${BUYER_FIELDS.join(",")})
              VALUES (?, ${BUYER_FIELDS.map(() => "?").join(",")})`)
    .run(now(), ...BUYER_FIELDS.map((f) => (b[f] === undefined || b[f] === "" ? null : b[f])));
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/buyers/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE buyers SET ${BUYER_FIELDS.map((f) => `${f} = ?`).join(",")} WHERE id = ?`)
    .run(...BUYER_FIELDS.map((f) => (b[f] === undefined || b[f] === "" ? null : b[f])), req.params.id);
  res.json({ ok: true });
});

app.delete("/api/buyers/:id", (req, res) => {
  db.prepare("DELETE FROM buyers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Most recent 9:00 AM Eastern (handles EST/EDT), returned as a UTC ISO string.
function etOffsetMinutes(d) {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((et - utc) / 60000); // e.g. -240 in summer (EDT)
}
function cutoff9amET() {
  const now = new Date();
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => +p.find((x) => x.type === t).value;
  const offUTC = -etOffsetMinutes(now); // minutes to ADD to local ET wall time to get UTC
  let cutoff = new Date(Date.UTC(g("year"), g("month") - 1, g("day"), 9, 0, 0) + offUTC * 60000);
  if (now < cutoff) cutoff = new Date(cutoff.getTime() - 86400000);
  return cutoff.toISOString();
}

// --- Offers sent (with projected vs collected fees) ---
app.get("/api/offers", (req, res) => {
  const rows = db.prepare(`SELECT id, address, seller_name, seller_email, stage,
      offer_sent_at, offer_amount, assignment_fee, fee_collected, fee_collected_at, contract_price
    FROM leads WHERE offer_sent_at IS NOT NULL ORDER BY offer_sent_at DESC`).all();
  const totals = {
    count: rows.length,
    // Projected = spread on deals still in flight (not closed/dead). Collected = fees on closed deals.
    projected: rows.filter((r) => !["Closed", "Dead"].includes(r.stage)).reduce((s, r) => s + (r.assignment_fee || 0), 0),
    collected: rows.filter((r) => r.stage === "Closed").reduce((s, r) => s + (r.fee_collected || 0), 0),
  };
  res.json({ offers: rows, totals });
});
// Close a deal and record the assignment fee collected. A fee is only "collected" at closing.
app.patch("/api/leads/:id/collect-fee", (req, res) => {
  const lead = db.prepare("SELECT id, address, stage FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  const amt = Number(req.body && req.body.amount);
  if (!(amt >= 0)) return res.status(400).json({ error: "Enter a valid amount" });
  const t = now();
  db.prepare("UPDATE leads SET fee_collected=?, fee_collected_at=?, stage='Closed', updated_at=? WHERE id=?")
    .run(amt || null, amt ? t : null, t, lead.id);
  if (lead.stage !== "Closed") logActivity(lead.id, "stage_change", `Stage: ${lead.stage} → Closed`);
  if (amt) logActivity(lead.id, "note", `💰 Deal closed — assignment fee collected: $${amt.toLocaleString()}`);
  res.json({ ok: true, stage: "Closed" });
});

// --- Dashboard stats ---
app.get("/api/stats", (req, res) => {
  const stages = db.prepare("SELECT stage, COUNT(*) n FROM leads WHERE active=1 GROUP BY stage").all();
  const totals = db
    .prepare(`SELECT COUNT(*) total,
                COALESCE(SUM(assignment_fee),0) pipeline_fees
              FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')`)
    .get();
  // Realized money = fees collected on CLOSED deals only.
  totals.collected_fees = db.prepare("SELECT COALESCE(SUM(fee_collected),0) c FROM leads WHERE stage='Closed' AND fee_collected IS NOT NULL").get().c;
  const today = new Date().toISOString().slice(0, 10);
  const followups = db
    .prepare(`SELECT id, seller_name, address, next_followup, stage FROM leads
              WHERE active=1 AND next_followup IS NOT NULL AND next_followup <= ?
                AND stage NOT IN ('Closed','Dead')
              ORDER BY next_followup ASC`)
    .all(today + "￿");
  const offersToday = db.prepare("SELECT COUNT(*) n FROM leads WHERE offer_sent_at >= ?").get(cutoff9amET()).n;
  const prospects = db.prepare("SELECT COUNT(*) n FROM leads WHERE active=0 AND stage != 'Dead'").get().n;
  res.json({ stages, totals, followups, today, offersToday, offersTarget: 5, prospects });
});

// ====================== ACQUISITIONS — Phase 1 ======================
const CAMPAIGN_FIELDS = ["name", "active", "city", "state", "zip", "property_type", "status",
  "price_min", "price_max", "beds_min", "baths_min", "sqft_min", "days_on_market_min"];

const acqNum = (k, d) => { const v = Number(getSetting(k)); return Number.isFinite(v) && v > 0 ? v : d; };
// Like acqNum but allows a valid 0 (only falls back to default when truly unset).
const acqInt = (k, d) => { const v = getSetting(k); return v === null || v === "" ? d : Number(v); };
const acqConfig = () => ({
  rehabPerSqft: acqNum("rehab_per_sqft", 25),
  buyerPct: acqNum("buyer_pct", 70),
  minFee: acqNum("min_fee", 10000),
  minScore: acqInt("min_score", 50),
  autoScanHours: acqInt("auto_scan_hours", 24),
  hotScore: acqNum("hot_score", 60),
  emailAlerts: getSetting("email_alerts") !== "0",
});
app.get("/api/acq/settings", (req, res) => {
  res.json({
    rentcastConnected: Boolean(getSetting("rentcast_api_key") || process.env.RENTCAST_API_KEY),
    aiConnected: Boolean(getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY),
    batchdataConnected: Boolean(getSetting("batchdata_api_key") || process.env.BATCHDATA_API_KEY),
    ...acqConfig(),
  });
});
app.post("/api/acq/settings", (req, res) => {
  const b = req.body || {};
  if (b.rentcast_api_key) setSetting("rentcast_api_key", String(b.rentcast_api_key).trim());
  if (b.anthropic_api_key) setSetting("anthropic_api_key", String(b.anthropic_api_key).trim());
  if (b.batchdata_api_key) setSetting("batchdata_api_key", String(b.batchdata_api_key).trim());
  for (const k of ["rehab_per_sqft", "buyer_pct", "min_fee", "min_score", "auto_scan_hours", "hot_score"]) {
    if (b[k] !== undefined && b[k] !== "") setSetting(k, String(b[k]));
  }
  if (b.email_alerts !== undefined) setSetting("email_alerts", b.email_alerts ? "1" : "0");
  res.json({ ok: true, rentcastConnected: Boolean(getSetting("rentcast_api_key")), ...acqConfig() });
});

async function rentcastGet(path, params) {
  const key = getSetting("rentcast_api_key") || process.env.RENTCAST_API_KEY;
  if (!key) throw new Error("Add your RentCast API key in the Acquisitions tab first.");
  const url = new URL("https://api.rentcast.io/v1" + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" } });
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 403 && text.includes("subscription-inactive"))
      throw new Error("RentCast subscription inactive — your free quota (≈50 lookups/mo) is likely used up, or the plan needs reactivating at app.rentcast.io → API. Scores, crime & agent phones already pulled still work.");
    if (r.status === 429) throw new Error("RentCast rate limit hit — wait a bit and retry.");
    throw new Error(`RentCast ${r.status}: ${text.slice(0, 180)}`);
  }
  try { return JSON.parse(text); } catch { return []; }
}

// Campaign CRUD
app.get("/api/campaigns", (req, res) => res.json(db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all()));
app.post("/api/campaigns", (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO campaigns (created_at, ${CAMPAIGN_FIELDS.join(",")})
      VALUES (?, ${CAMPAIGN_FIELDS.map(() => "?").join(",")})`)
    .run(now(), ...CAMPAIGN_FIELDS.map((f) => (f === "active" ? (b[f] === 0 ? 0 : 1) : (b[f] === undefined || b[f] === "" ? null : b[f]))));
  res.json({ id: info.lastInsertRowid });
});
app.put("/api/campaigns/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE campaigns SET ${CAMPAIGN_FIELDS.map((f) => `${f}=?`).join(",")} WHERE id=?`)
    .run(...CAMPAIGN_FIELDS.map((f) => (f === "active" ? (b[f] ? 1 : 0) : (b[f] === undefined || b[f] === "" ? null : b[f]))), req.params.id);
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id", (req, res) => { db.prepare("DELETE FROM campaigns WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// Run a campaign — pull from RentCast and dedup into the property store
async function executeCampaign(c) {
  const listings = await rentcastGet("/listings/sale", {
    city: c.city, state: c.state, zipCode: c.zip,
    propertyType: c.property_type, status: c.status || "Active",
    daysOld: c.days_on_market_min || undefined, limit: 500,
  });
  const arr = Array.isArray(listings) ? listings : [];
  const hotScore = Number(getSetting("hot_score")) || 60;
  let neu = 0, upd = 0; const newHotIds = []; const t = now();
  {
    for (const L of arr) {
      if (c.price_min && L.price && L.price < c.price_min) continue;
      if (c.price_max && L.price && L.price > c.price_max) continue;
      if (c.beds_min && L.bedrooms && L.bedrooms < c.beds_min) continue;
      if (c.baths_min && L.bathrooms && L.bathrooms < c.baths_min) continue;
      if (c.sqft_min && L.squareFootage && L.squareFootage < c.sqft_min) continue;
      const fa = L.formattedAddress || [L.addressLine1, L.city, L.state, L.zipCode].filter(Boolean).join(", ");
      if (!fa) continue;
      const key = fa.toLowerCase();
      const existing = db.prepare("SELECT id, wholesale_score FROM properties WHERE addr_key=?").get(key);
      const vals = {
        addr_key: key, last_seen: t, campaign_id: c.id, source: "rentcast", source_id: L.id || null,
        formatted_address: fa, address: L.addressLine1 || null, city: L.city || null, state: L.state || null, zip: L.zipCode || null, county: L.county || null,
        latitude: L.latitude || null, longitude: L.longitude || null,
        property_type: L.propertyType || null, bedrooms: L.bedrooms || null, bathrooms: L.bathrooms || null,
        square_footage: L.squareFootage || null, lot_size: L.lotSize || null, year_built: L.yearBuilt || null,
        status: L.status || null, price: L.price || null, listed_date: L.listedDate || null, removed_date: L.removedDate || null,
        days_on_market: L.daysOnMarket || null, price_history: L.history ? JSON.stringify(L.history) : null,
        listing_agent_name: (L.listingAgent && L.listingAgent.name) || (L.listingOffice && L.listingOffice.name) || null,
        listing_agent_phone: (L.listingAgent && L.listingAgent.phone) || (L.listingOffice && L.listingOffice.phone) || null,
        listing_agent_email: (L.listingAgent && L.listingAgent.email) || (L.listingOffice && L.listingOffice.email) || null,
      };
      const sc = scoreListing(vals);
      vals.motivation_score = sc.motivation;
      vals.distress_score = sc.distress;
      vals.lead_score = sc.lead;
      if (existing) {
        const lead = blendLead(sc, existing.wholesale_score);
        db.prepare(`UPDATE properties SET updated_at=?, last_seen=?, status=?, price=?, days_on_market=?, price_history=?, campaign_id=?, motivation_score=?, distress_score=?, lead_score=?, listing_agent_name=?, listing_agent_phone=?, listing_agent_email=? WHERE id=?`)
          .run(t, t, vals.status, vals.price, vals.days_on_market, vals.price_history, c.id, sc.motivation, sc.distress, lead, vals.listing_agent_name, vals.listing_agent_phone, vals.listing_agent_email, existing.id);
        upd++;
      } else {
        const cols = Object.keys(vals);
        const info = db.prepare(`INSERT INTO properties (created_at, updated_at, ${cols.join(",")}) VALUES (?,?, ${cols.map(() => "?").join(",")})`)
          .run(t, t, ...cols.map((k) => vals[k]));
        neu++;
        if (sc.lead >= hotScore) newHotIds.push(info.lastInsertRowid);
      }
    }
  }
  db.prepare("UPDATE campaigns SET last_run=?, last_count=? WHERE id=?").run(t, arr.length, c.id);
  return { found: arr.length, neu, upd, newHotIds };
}

app.post("/api/campaigns/:id/run", async (req, res) => {
  const c = db.prepare("SELECT * FROM campaigns WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  try {
    const r = await executeCampaign(c);
    const crimeScanned = await scanCrimePending(); // shootings load as part of the run
    createHotNotifications(r.newHotIds);           // populate the 🔔 bell
    res.json({ found: r.found, new: r.neu, updated: r.upd, crimeScanned, hot: r.newHotIds.length });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---- Notifications + hot-lead alerts (Phase 4) ----
function createHotNotifications(ids) {
  const created = [];
  for (const id of [...new Set(ids || [])]) {
    if (db.prepare("SELECT 1 FROM notifications WHERE property_id=?").get(id)) continue; // no dupes
    const p = db.prepare("SELECT * FROM properties WHERE id=?").get(id);
    if (!p) continue;
    const title = `🔥 New hot lead — score ${p.lead_score}`;
    const body = `${p.formatted_address} · ${fmtMoney(p.price)}${p.crime_shootings_30d != null ? ` · 🔫 ${p.crime_shootings_30d}` : ""}`;
    const info = db.prepare("INSERT INTO notifications (created_at, type, title, body, property_id, read) VALUES (?,?,?,?,?,0)")
      .run(now(), "hot", title, body, id);
    created.push({ id: info.lastInsertRowid, title, body, property: p });
  }
  return created;
}
async function emailHotDigest(notes) {
  if (!notes.length || !emailConfigured() || !acqConfig().emailAlerts) return;
  const lines = notes.map((n) => `• ${n.body} — lead score ${n.property.lead_score}`).join("\n");
  try {
    await sendOne(makeTransport(), emailCfg().user,
      `🔥 ${notes.length} new hot lead(s) — Castle Home Buyers`,
      `Your CRM's daily scan found ${notes.length} new hot lead(s):\n\n${lines}\n\nOpen the Acquisitions tab to review and import.`);
  } catch { /* email failure shouldn't break the scan */ }
}

app.get("/api/notifications", (req, res) => {
  const rows = db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100").all();
  res.json({ items: rows, unread: rows.filter((n) => !n.read).length });
});
app.post("/api/notifications/read-all", (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE read=0").run();
  res.json({ ok: true });
});

// Daily auto-scan: runs active campaigns, loads crime, alerts on new hot leads.
async function runAutoScan() {
  const camps = db.prepare("SELECT * FROM campaigns WHERE active=1").all();
  if (!camps.length) return;
  const hotIds = [];
  for (const c of camps) {
    try { const r = await executeCampaign(c); hotIds.push(...r.newHotIds); } catch (e) { console.error("auto-scan campaign failed:", e.message); }
  }
  await scanCrimePending();
  const notes = createHotNotifications(hotIds);
  await emailHotDigest(notes);
  console.log(`  🤖 Auto-scan done — ${notes.length} new hot lead(s)`);
}
function maybeAutoScan() {
  const hours = acqConfig().autoScanHours;
  if (!hours || hours <= 0) return; // disabled
  const last = getSetting("last_auto_scan");
  if (!last) { setSetting("last_auto_scan", new Date().toISOString()); return; } // start the clock; first auto-run is one interval from now
  if (Date.now() - new Date(last).getTime() < hours * 3600e3) return;
  setSetting("last_auto_scan", new Date().toISOString());
  runAutoScan().catch((e) => console.error("auto-scan error:", e.message));
}
setInterval(maybeAutoScan, 60 * 60 * 1000); // check hourly
setTimeout(maybeAutoScan, 45 * 1000);        // and shortly after startup

// ---- AI Acquisitions Assistant (Phase 5) — Claude Opus 4.8 ----
function anthropicClient() {
  const key = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}
function buildDealPrompt(p) {
  const m = (n) => (n || n === 0) && !isNaN(n) ? "$" + Number(n).toLocaleString() : "n/a";
  const reductions = parseHistory(p.price_history);
  return [
    `Property: ${p.formatted_address || p.address || "Unknown"}`,
    `Type: ${p.property_type || "n/a"} · ${p.bedrooms || "?"}bd/${p.bathrooms || "?"}ba · ${p.square_footage ? p.square_footage + " sqft" : "sqft n/a"} · built ${p.year_built || "n/a"}`,
    `List price: ${m(p.price)} · Days on market: ${p.days_on_market ?? "n/a"} · Status: ${p.status || "n/a"}`,
    `Price reductions on this listing: ${reductions.reductions} (total ${reductions.reductionPct.toFixed(1)}% off original)`,
    `Estimated ARV (RentCast AVM): ${m(p.arv)} · Estimated repairs: ${m(p.repair_estimate)} · Estimated rent: ${m(p.rent_estimate)}/mo`,
    `Calculated Max Allowable Offer (MAO): ${m(p.mao)} · Built-in wholesale fee at MAO: ${m(p.spread)} · Discount needed vs list: ${p.discount_pct != null ? p.discount_pct + "%" : "n/a"}`,
    `Cap rate (if held as rental): ${p.cap_rate != null ? p.cap_rate + "%" : "n/a"}`,
    `Scores (0-100): Lead ${p.lead_score ?? "n/a"} · Motivation ${p.motivation_score ?? "n/a"} · Distress ${p.distress_score ?? "n/a"} · Wholesale ${p.wholesale_score ?? "n/a"}`,
    `Shootings within 1 mile in last 30 days: ${p.crime_shootings_30d ?? "n/a"}`,
    `Listing agent: ${p.listing_agent_name || "n/a"}${p.listing_agent_phone ? " (" + p.listing_agent_phone + ")" : ""}`,
  ].join("\n");
}
app.post("/api/properties/:id/ai", async (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (p.ai_analysis && !(req.body && req.body.force)) return res.json({ analysis: p.ai_analysis, cached: true });
  const client = anthropicClient();
  if (!client) return res.status(400).json({ error: "Add your Anthropic API key in the Acquisitions tab first." });
  try {
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: "You are a sharp, no-nonsense real estate acquisitions manager and negotiator for a wholesaling business called Castle Home Buyers. You evaluate on-market deals and give the operator a short, actionable brief. Be concrete and honest — if a deal is weak at the asking price, say so plainly. Use the numbers given; never invent data. Keep it tight and skimmable.",
      messages: [{
        role: "user",
        content: `Here is a property my system flagged. Write a brief in Markdown with these exact sections (use ## headers):\n\n## Deal Summary\nA 2-3 sentence read on whether this is a real deal and why (or why not), grounded in the numbers.\n\n## Opportunity Analysis\nWhat's driving the score — motivation/distress signals, equity/spread, days on market, price cuts, crime. Call out red flags (e.g. high crime, no spread at list).\n\n## Offer Recommendation\nThe specific number to offer and the logic. Reference the MAO. If the MAO is far below list, say what discount you'd need and whether it's realistic.\n\n## Seller / Agent Talking Points\n3-4 bullet openers I can use when I call the listing agent — tuned to the situation.\n\n## Negotiation Strategy\n2-3 concrete tactics for this specific deal.\n\nKeep the whole thing under ~350 words. Here is the data:\n\n${buildDealPrompt(p)}`,
      }],
    });
    if (msg.stop_reason === "refusal") return res.status(502).json({ error: "The model declined to analyze this property." });
    const analysis = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!analysis) return res.status(502).json({ error: "Empty response from the model." });
    db.prepare("UPDATE properties SET ai_analysis=?, updated_at=? WHERE id=?").run(analysis, now(), p.id);
    res.json({ analysis, cached: false });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Property feed
app.get("/api/properties", (req, res) => {
  res.json(db.prepare("SELECT * FROM properties ORDER BY (lead_score IS NULL), lead_score DESC, created_at DESC LIMIT 500").all());
});
app.get("/api/properties/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

// ---- Phase 2: scoring (free, from listing data) + analysis (AVM, on-demand) ----
function parseHistory(historyJson) {
  if (!historyJson) return { reductions: 0, reductionPct: 0 };
  let h; try { h = JSON.parse(historyJson); } catch { return { reductions: 0, reductionPct: 0 }; }
  const entries = Array.isArray(h) ? h : Object.values(h || {});
  const prices = entries.map((e) => e && e.price).filter((p) => typeof p === "number" && p > 0);
  if (prices.length < 2) return { reductions: 0, reductionPct: 0 };
  let reductions = 0;
  for (let i = 1; i < prices.length; i++) if (prices[i] < prices[i - 1]) reductions++;
  const first = prices[0], last = prices[prices.length - 1];
  return { reductions, reductionPct: first > 0 ? Math.max(0, (first - last) / first * 100) : 0 };
}
function scoreListing(p) {
  const dom = p.days_on_market || 0;
  const { reductions, reductionPct } = parseHistory(p.price_history);
  const age = p.year_built ? new Date().getFullYear() - p.year_built : 0;
  let motivation = Math.min(50, dom / 90 * 50) + Math.min(35, reductionPct * 3) + Math.min(15, reductions * 7);
  motivation = Math.round(Math.min(100, motivation));
  let distress = Math.min(40, reductionPct * 3.5) + Math.min(25, dom / 120 * 25) + Math.min(20, age / 60 * 20);
  if ((p.status || "").toLowerCase() === "inactive") distress += 15;
  distress = Math.round(Math.min(100, distress));
  const lead = Math.round(Math.min(100, motivation * 0.5 + distress * 0.5));
  return { motivation, distress, lead };
}
function blendLead(s, wholesale) {
  return wholesale == null ? s.lead : Math.round(Math.min(100, s.motivation * 0.3 + s.distress * 0.3 + wholesale * 0.4));
}

// Free re-score of every property from listing data
app.post("/api/properties/score-all", (req, res) => {
  const props = db.prepare("SELECT * FROM properties").all();
  const upd = db.prepare("UPDATE properties SET motivation_score=?, distress_score=?, lead_score=?, updated_at=? WHERE id=?");
  const t = now();
  for (const p of props) {
    const s = scoreListing(p);
    upd.run(s.motivation, s.distress, blendLead(s, p.wholesale_score), t, p.id);
  }
  res.json({ scored: props.length });
});

// Derive the deal math from stored ARV/rent + current settings (no API calls).
function deriveAnalysis(p) {
  const cfg = acqConfig();
  const arv = p.arv || 0;
  const sqft = p.square_footage || 0;
  const rent = p.rent_estimate || 0;
  const repairs = Math.round(sqft * cfg.rehabPerSqft);
  const buyerMax = arv * (cfg.buyerPct / 100) - repairs; // most a cash buyer pays
  const mao = Math.round(buyerMax - cfg.minFee);          // your max offer (leaves your fee)
  const listPrice = p.price || 0;
  const fee = cfg.minFee;                                 // your spread at MAO (always positive)
  const discount = listPrice - mao;
  const discountPct = listPrice > 0 ? +(discount / listPrice * 100).toFixed(1) : 0;
  const equity = Math.round(arv - listPrice);
  const noi = rent * 12 * 0.6;
  const capRate = arv ? +(noi / arv * 100).toFixed(1) : 0;
  // Wholesale/deal score = how achievable the offer is (small discount = strong deal) + a cap-rate kicker
  let wholesale = mao <= 0 ? 0 : 100 - discountPct * 2.2;        // 0% below list → 100, ~45% → 0
  wholesale += Math.min(10, Math.max(0, (capRate - 8)));         // bonus for strong rentals
  wholesale = Math.round(Math.max(0, Math.min(100, wholesale)));
  return { repairs, mao, fee, spread: fee, discountPct, equity, capRate, wholesale };
}
function persistAnalysis(p, d) {
  const s = scoreListing(p);
  const lead = Math.round(Math.min(100, s.motivation * 0.25 + s.distress * 0.25 + d.wholesale * 0.5));
  db.prepare(`UPDATE properties SET repair_estimate=?, spread=?, mao=?, discount_pct=?, equity=?, cap_rate=?,
      wholesale_score=?, motivation_score=?, distress_score=?, lead_score=?, updated_at=? WHERE id=?`)
    .run(d.repairs, d.spread, d.mao, d.discountPct, d.equity, d.capRate, d.wholesale, s.motivation, s.distress, lead, now(), p.id);
  return { ...d, motivation: s.motivation, distress: s.distress, lead };
}

// Deep deal analysis via RentCast AVM (uses 2 lookups: value + rent)
app.post("/api/properties/:id/analyze", async (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  try {
    const common = {
      address: p.formatted_address, propertyType: p.property_type || undefined,
      bedrooms: p.bedrooms || undefined, bathrooms: p.bathrooms || undefined, squareFootage: p.square_footage || undefined,
    };
    const val = await rentcastGet("/avm/value", common);
    const rentResp = await rentcastGet("/avm/rent/long-term", common);
    const arv = (val && (val.price || val.value)) || 0;
    const rent = (rentResp && (rentResp.rent || rentResp.price)) || 0;
    db.prepare("UPDATE properties SET arv=?, rent_estimate=? WHERE id=?").run(arv, rent, p.id);
    const fresh = db.prepare("SELECT * FROM properties WHERE id=?").get(p.id);
    const out = persistAnalysis(fresh, deriveAnalysis(fresh));
    res.json({ arv, rent, ...out });
  } catch (err) { res.status(500).json({ error: String(err.message || err) }); }
});

// Import a property straight into the CRM as a lead (with the listing agent's phone).
app.post("/api/properties/:id/import", (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (p.imported_lead_id && db.prepare("SELECT id FROM leads WHERE id=?").get(p.imported_lead_id)) {
    return res.json({ leadId: p.imported_lead_id, already: true });
  }
  const addr = p.address || p.formatted_address || "";
  const dupe = addr ? db.prepare("SELECT id FROM leads WHERE lower(address)=lower(?)").get(addr) : null;
  const t = now();
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const contact = p.listing_agent_name
    ? `Listing agent: ${p.listing_agent_name}${p.listing_agent_phone ? " · " + p.listing_agent_phone : ""}${p.listing_agent_email ? " · " + p.listing_agent_email : ""}`
    : "No agent on file — skip-trace the owner for a phone number.";
  const dealLine = p.arv ? `ARV ${fmtMoney(p.arv)} · MAO ${fmtMoney(p.mao)} · fee ${fmtMoney(p.spread)} · ${p.discount_pct}% vs list` : "Not yet analyzed";
  const crimeLine = p.crime_shootings_30d != null ? `\n🔫 ${p.crime_shootings_30d} shooting(s) within 1mi in last 30 days` : "";
  const notes = `Imported from Acquisitions (lead score ${p.lead_score ?? "—"}).\nList price: ${fmtMoney(p.price)}\n${dealLine}\n${contact}${crimeLine}`;

  let leadId;
  if (dupe) {
    leadId = dupe.id;
    logActivity(leadId, "note", "Re-linked from Acquisitions.\n" + contact);
  } else {
    const info = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, seller_name, seller_phone, seller_email,
        address, city, state, zip, property_type, asking_price, arv, repair_estimate, motivation, source, next_followup, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(t, t, "New",
        p.listing_agent_name ? p.listing_agent_name + " (listing agent)" : null,
        p.listing_agent_phone || null, p.listing_agent_email || null,
        addr, p.city, p.state, p.zip, p.property_type, p.price, p.arv, p.repair_estimate,
        "Listed / acquisitions", "Acquisitions (RentCast)", null, notes);
    leadId = info.lastInsertRowid;
    logActivity(leadId, "note", notes);
    // No auto task/follow-up — the user adds one per lead when they want it.
  }
  db.prepare("UPDATE properties SET imported_lead_id=?, review_status='Reviewing', updated_at=? WHERE id=?").run(leadId, t, p.id);
  res.json({ leadId, already: false, duplicate: Boolean(dupe) });
});

// ---- Crime: shootings within 1 mile in the last 30 days (Detroit Open Data, free) ----
const DETROIT_CRIME = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer/0/query";
async function countShootings30d(lat, lon) {
  if (!lat || !lon) return null;
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const u = new URL(DETROIT_CRIME);
  const params = {
    where: `offense_description LIKE '%SHOOTING%' AND incident_occurred_at >= DATE '${d30}'`,
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    distance: "1609", units: "esriSRUnit_Meter", spatialRel: "esriSpatialRelIntersects",
    returnCountOnly: "true", f: "json",
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const r = await fetch(u);
    const j = await r.json();
    return typeof j.count === "number" ? j.count : null;
  } catch { return null; }
}

// Scan crime for properties missing it (Detroit only). Parallelized + single-flight.
let crimeScanRunning = false;
async function scanCrimePending() {
  if (crimeScanRunning) return 0;
  crimeScanRunning = true;
  try {
    const rows = db.prepare(`SELECT id, latitude, longitude FROM properties
      WHERE crime_shootings_30d IS NULL AND latitude IS NOT NULL
        AND (lower(city)='detroit' OR state='MI')`).all();
    let scanned = 0;
    const CONC = 15;
    for (let i = 0; i < rows.length; i += CONC) {
      await Promise.all(rows.slice(i, i + CONC).map(async (p) => {
        const n = await countShootings30d(p.latitude, p.longitude);
        if (n != null) { db.prepare("UPDATE properties SET crime_shootings_30d=?, updated_at=? WHERE id=?").run(n, now(), p.id); scanned++; }
      }));
    }
    return scanned;
  } finally { crimeScanRunning = false; }
}
app.post("/api/properties/scan-crime", async (req, res) => {
  const scanned = await scanCrimePending();
  res.json({ scanned });
});

// Recompute all analyzed properties from stored ARV/rent (FREE — no lookups). Re-scores everything.
app.post("/api/properties/recompute", (req, res) => {
  const props = db.prepare("SELECT * FROM properties").all();
  let analyzed = 0;
  for (const p of props) {
    if (p.arv != null) { persistAnalysis(p, deriveAnalysis(p)); analyzed++; }
    else {
      const s = scoreListing(p);
      db.prepare("UPDATE properties SET motivation_score=?, distress_score=?, lead_score=?, updated_at=? WHERE id=?")
        .run(s.motivation, s.distress, s.lead, now(), p.id);
    }
  }
  res.json({ total: props.length, analyzed });
});

// ---------- Automatic backups (so a disk failure can't lose your leads) ----------
const BACKUP_DIR = join(__dirname, "backups");
mkdirSync(BACKUP_DIR, { recursive: true });
let lastBackup = null;
function makeBackup() {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(BACKUP_DIR, `crm-${ts}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); // consistent snapshot
    const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("crm-") && f.endsWith(".db")).sort();
    while (files.length > 30) unlinkSync(join(BACKUP_DIR, files.shift())); // keep newest 30
    lastBackup = new Date().toISOString();
    return file;
  } catch (e) { console.error("Backup failed:", e.message); return null; }
}

app.post("/api/backup", (req, res) => {
  const f = makeBackup();
  res.json(f ? { ok: true, file: f.split("/").pop(), at: lastBackup } : { error: "backup failed" });
});
app.get("/api/backup/status", (req, res) => {
  const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("crm-") && f.endsWith(".db")).sort();
  res.json({ count: files.length, last: lastBackup, latest: files[files.length - 1] || null });
});

// CSV export of all leads — your data, downloadable anytime.
app.get("/api/export/leads.csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM leads ORDER BY created_at").all();
  const cols = ["id", "created_at", "updated_at", ...LEAD_FIELDS];
  const esc = (v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="castle-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  makeBackup(); // snapshot on every startup
  setInterval(makeBackup, 6 * 60 * 60 * 1000); // and every 6 hours
  console.log(`\n  🏠  Wholesale CRM running →  http://localhost:${PORT}\n`);
  console.log(`  Email: ${emailConfigured() ? "✅ Gmail connected (" + emailCfg().user + ")" : "⚠️  not configured — connect in the Outreach tab"}`);
  console.log(`  Backups: auto every 6h → ${BACKUP_DIR}\n`);
});
