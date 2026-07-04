import express from "express";
import { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { mountCrmSubstrate, mirrorLead, mirrorActivity, mirrorEmail, childrenOfLead,
  mirrorTask, mirrorNote, mirrorNotification, mirrorBuyer, mirrorTemplate, mirrorSetting,
  mirrorProperty, mirrorCampaign, mirrorPlan, planThingaId } from "./crm_thinga.js";
import { buildRegistry } from "./connectors/index.js";
import { createSourceHealth } from "./source_health.js";
import { findContact } from "./contact_router.js";
import { buildRealEstateEngine } from "./packs/real_estate_acquisition.js";
import { canonicalAddr, geocodeAddress } from "./connectors/census.js";
import { buildPropertyImageryEvidence } from "./property_imagery.js";
import { rankBuyersForProperty } from "./buyer_matching.js";
import { normalizeBuyerCandidate, rankBuyerDemand, BUYER_DISCOVERY_SOURCE_FAMILIES, qualifiesForPromotion } from "./buyer_discovery.js";
import { runAutonomousLeadCycle } from "./autonomous_lead_engine.js";
import { evaluateWholesaleSpread, summarizeSpreadAudits } from "./wholesale_spread.js";
import { resolveContactRoute } from "./contact_route_engine.js";
import { makeConsentRecord, consentToContactCandidate } from "./consent.js";
import { complianceCheck } from "./compliance_gate.js";
import { skiptraceDecision } from "./skiptrace_gate.js";
import { whyNotCallNow, applyOutreachSuppression } from "./pro_wholesaler_queue.js";
import { bestSellerPriceEvidence, sellerPriceEvidenceFromRecord } from "./seller_price_evidence.js";
import { buildProofStack, buyerSafeProofStack } from "./proof_stack.js";
import { createKgPool, kgConnectionString } from "./kg_projection_persistence.js";
import { buildPropertyKgEvidenceView } from "./kg_evidence_view.js";
import { buildInvestorMarketplace } from "./investor_marketplace.js";
import { buildBuyerInterestQueue, buildBuyerInterestRequest } from "./buyer_interest.js";
import { buildSellerIntakeQueue } from "./seller_intake.js";
import { buildSellerPromotionWorkflow } from "./seller_promotion.js";
import { listCouncilJobs, loadCouncilParticipants, readCouncilJob, retryCouncilJob, syncCouncilJobResponses, writeAndDispatchCouncilReview } from "./council_dispatch.js";
import { leadEngineSettingsWrites, leadEngineTickDecision, normalizeLeadEngineSettings } from "./lead_engine_scheduler.js";
import { buildEcosystemSnapshot, normalizeSearchPlan } from "./ecosystem_search_plan.js";
import { runPipeline, PIPELINE_STAGES, PIPELINE_PRESETS, resolveStageIds } from "./pipeline_run.js";
import { createParseMemory, signatureOf } from "./parse_memory.js";
import { normalizeCallOutcome, summarizeOutcomes } from "./call_outcome.js";
import { createDncStore, normalizePhone } from "./dnc_records.js";
import { buildThingaImportV2 } from "./ankhor_bridge.js";

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
// Concurrent writers exist by design (pipeline tools run as child processes
// against the same crm.db). Without a busy timeout, any overlap turns into an
// instant SQLITE_BUSY throw — one such throw inside a timer killed the whole
// server (maybeAutoLeadEngine during build_pro_queue --persist). Wait instead.
db.exec("PRAGMA busy_timeout = 15000");

// Background timers must NEVER crash the process: a transient error (db lock,
// network, mail) is logged and the next tick tries again.
const safeTick = (name, fn) => () => {
  try {
    const r = fn();
    if (r && typeof r.catch === "function") r.catch((e) => console.error(`[${name}] tick failed:`, e.message));
  } catch (e) { console.error(`[${name}] tick failed:`, e.message); }
};
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
  "owner_name TEXT", "owner_mailing TEXT", "owner_source TEXT", "owner_enriched_at TEXT",
  "crime_shootings_30d INTEGER", "ai_analysis TEXT"]) {
  try { db.exec(`ALTER TABLE properties ADD COLUMN ${col}`); } catch { /* already exists */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL, type TEXT, title TEXT, body TEXT,
  property_id INTEGER, read INTEGER DEFAULT 0
);`);
db.exec(`CREATE TABLE IF NOT EXISTS property_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  status TEXT,
  summary TEXT,
  data_json TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_property_evidence_prop ON property_evidence(property_id, created_at DESC)");
db.exec(`CREATE TABLE IF NOT EXISTS lead_engine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  target_json TEXT NOT NULL,
  raw_records INTEGER DEFAULT 0,
  raw_thingas INTEGER DEFAULT 0,
  converged_properties INTEGER DEFAULT 0,
  shortlist_count INTEGER DEFAULT 0,
  dispatched_council INTEGER DEFAULT 0,
  council_packet TEXT,
  data_json TEXT NOT NULL
);`);
db.exec(`CREATE TABLE IF NOT EXISTS lead_engine_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  thinga_id TEXT,
  address TEXT,
  score INTEGER,
  tier TEXT,
  spend_allowed INTEGER DEFAULT 0,
  lead_id INTEGER,
  status TEXT DEFAULT 'shortlisted',
  data_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES lead_engine_runs(id) ON DELETE CASCADE
);`);
try { db.exec("ALTER TABLE lead_engine_candidates ADD COLUMN lead_id INTEGER"); } catch { /* already exists */ }
db.exec("CREATE INDEX IF NOT EXISTS idx_lead_engine_candidates_run ON lead_engine_candidates(run_id, score DESC)");
db.exec("CREATE INDEX IF NOT EXISTS idx_lead_engine_candidates_status ON lead_engine_candidates(status, score DESC)");
// Fill-Properties pipeline runs (the one-button chain). One row per run; stages_json
// holds the live per-stage progress the operator UI polls.
db.exec(`CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  preset TEXT,
  stage_ids TEXT,
  filters_json TEXT,
  current_stage TEXT,
  stages_json TEXT,
  tier_counts_json TEXT,
  error TEXT
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created ON pipeline_runs(created_at DESC)");
// A run only lives in this process; if we restarted, any row still 'running' is a
// zombie from a prior process — reconcile it so the UI doesn't poll it forever.
try { db.prepare("UPDATE pipeline_runs SET status='interrupted', finished_at=?, error='server restarted mid-run' WHERE status='running'").run(new Date().toISOString()); } catch { /* table just created */ }
// Retention: keep the newest 200 runs (each carries full stages_json). The runs
// also live as kind:pipeline_run Thingas, so history is never truly lost.
try { db.prepare("DELETE FROM pipeline_runs WHERE id NOT IN (SELECT id FROM pipeline_runs ORDER BY id DESC LIMIT 200)").run(); } catch { /* table just created */ }
// The memory unit the generic parser consults before parsing (parse_memory.js).
const parseMemory = createParseMemory(db);
// Persisted DNC/consent verdicts (dnc_records.js — audit P1 #2).
const dncStore = createDncStore(db);
// Post-dial paper trail (call_outcome.js — audit P1 #4).
db.exec(`CREATE TABLE IF NOT EXISTS call_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  next_action TEXT,
  seller_price REAL,
  offer_amount REAL,
  follow_up_date TEXT,
  outreach_suppressed INTEGER DEFAULT 0,
  notes TEXT
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_call_outcomes_property ON call_outcomes(property_id, id DESC)");
db.exec(`CREATE TABLE IF NOT EXISTS ecosystem_search_plans (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  data_json TEXT NOT NULL
);`);
db.exec(`CREATE TABLE IF NOT EXISTS buyer_discovery_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  areas TEXT,
  property_types TEXT,
  max_price REAL,
  cash INTEGER DEFAULT 1,
  source_id TEXT,
  source_type TEXT,
  confidence TEXT,
  evidence_json TEXT NOT NULL,
  imported_buyer_id INTEGER
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_buyer_candidates_source ON buyer_discovery_candidates(source_id, name)");
db.exec("CREATE INDEX IF NOT EXISTS idx_buyer_candidates_imported ON buyer_discovery_candidates(imported_buyer_id)");
db.exec(`CREATE TABLE IF NOT EXISTS seller_price_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  price REAL NOT NULL,
  confidence TEXT,
  source TEXT,
  source_record_id TEXT,
  context TEXT,
  reason TEXT,
  data_json TEXT NOT NULL,
  UNIQUE(record_type, record_id, price, source, source_record_id, context)
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_seller_price_record ON seller_price_evidence(record_type, record_id, confidence)");
db.exec(`CREATE TABLE IF NOT EXISTS marketplace_interest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  property_id INTEGER NOT NULL,
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_phone TEXT,
  buyer_buy_box TEXT,
  message TEXT,
  deal_title TEXT,
  market TEXT,
  proof_url TEXT,
  kg_evidence_url TEXT,
  status TEXT NOT NULL DEFAULT 'new_interest'
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_marketplace_interest_property ON marketplace_interest(property_id, created_at)");
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
  "rent_estimate REAL", "latitude REAL", "longitude REAL", "comps_json TEXT", "arv_source TEXT",
  "addr_canon TEXT"]) {
  try { db.exec(`ALTER TABLE leads ADD COLUMN ${col}`); } catch { /* already exists */ }
}
db.exec("CREATE INDEX IF NOT EXISTS idx_leads_canon ON leads(addr_canon)"); // never-duplicates lookup
// One-time backfill so cross-run dedup works against pre-existing leads.
try {
  const rows = db.prepare("SELECT id, address FROM leads WHERE addr_canon IS NULL AND address IS NOT NULL").all();
  const upd = db.prepare("UPDATE leads SET addr_canon=? WHERE id=?");
  for (const r of rows) upd.run(canonicalAddr(r.address), r.id);
} catch { /* canonicalAddr available post-import */ }
const setCanon = (id, address) => { try { db.prepare("UPDATE leads SET addr_canon=? WHERE id=?").run(canonicalAddr(address || ""), id); } catch {} };
// One-time: bulk-pulled records (code violations / imported lists) start as Prospects, not active leads.
if (!db.prepare("SELECT value FROM settings WHERE key='migrated_active_v1'").get()) {
  db.prepare("UPDATE leads SET active=0 WHERE source='Detroit code violations' OR source LIKE '% list'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('migrated_active_v1', '1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
}

const now = () => new Date().toISOString();

const DEFAULT_SEARCH_PLANS = [
  {
    id: "all-enabled",
    name: "All enabled sources",
    description: "Every enabled connector the ecosystem currently knows about.",
    costPolicy: "free_first",
    notes: ["No fixed source count. Execution limits are optional cost/rate controls."],
  },
  {
    id: "distress-contact",
    name: "Distress + public contact",
    description: "Public violations, distressed property signals, and public contact sources.",
    includeSourceTypes: ["violations", "property", "public-contact"],
    costPolicy: "free_first",
  },
  {
    id: "on-market",
    name: "On-market listings",
    description: "Licensed/keyed listing sources that can expose active listings and agent contacts.",
    includeSourceTypes: ["listings"],
    costPolicy: "licensed_or_keyed",
  },
];

const slugifyPlanId = (v) => String(v || "search-plan")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80) || "search-plan";

function searchPlanRow(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
  const plan = normalizeSearchPlan({ ...data, id: row.id, name: row.name });
  return {
    ...plan,
    description: row.description || data.description || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function saveSearchPlan(input = {}) {
  const id = slugifyPlanId(input.id || input.name);
  const existing = db.prepare("SELECT id, created_at FROM ecosystem_search_plans WHERE id=?").get(id);
  const plan = normalizeSearchPlan({ ...input, id });
  const name = String(input.name || plan.name || id).trim() || id;
  const description = String(input.description || "").trim();
  const at = now();
  db.prepare(`INSERT INTO ecosystem_search_plans (id, created_at, updated_at, name, description, data_json)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at=excluded.updated_at,
        name=excluded.name,
        description=excluded.description,
        data_json=excluded.data_json`)
    .run(id, existing?.created_at || at, at, name, description, JSON.stringify({ ...plan, name, description }));
  return getSearchPlan(id);
}

function seedSearchPlans() {
  for (const plan of DEFAULT_SEARCH_PLANS) {
    if (!db.prepare("SELECT id FROM ecosystem_search_plans WHERE id=?").get(plan.id)) saveSearchPlan(plan);
  }
}

function listSearchPlans() {
  seedSearchPlans();
  return db.prepare("SELECT * FROM ecosystem_search_plans ORDER BY name COLLATE NOCASE").all().map(searchPlanRow);
}

function getSearchPlan(id) {
  seedSearchPlans();
  return searchPlanRow(db.prepare("SELECT * FROM ecosystem_search_plans WHERE id=?").get(slugifyPlanId(id || "all-enabled")));
}

function searchPlanFromRequest(input = {}) {
  const base = input.planId ? (getSearchPlan(input.planId) || {}) : {};
  const maxConnectors = input.sourceLimit == null || input.sourceLimit === "" || Number(input.sourceLimit) <= 0
    ? (input.maxConnectors ?? input.searchPlan?.maxConnectors ?? base.maxConnectors)
    : input.sourceLimit;
  return normalizeSearchPlan({
    ...base,
    ...(input.searchPlan || {}),
    includeSourceTypes: Array.isArray(input.sourceTypes) ? input.sourceTypes : (base.includeSourceTypes || []),
    includeConnectorIds: Array.isArray(input.connectorIds) ? input.connectorIds : (base.includeConnectorIds || []),
    maxConnectors,
  });
}
seedSearchPlans();

// ---------- Ankhor / Thinga substrate (non-destructive interop) ----------
// Mirrors CRM rows into a `thingas` store living ALONGSIDE the eleven tables. The app is never
// blocked by it: every mirror is guarded. Roadmap: dev/plans/6-26-26/01-SUBSTRATE.md. Runtime: thinga.js.
// Real verb handlers (score_property/underwrite_lead/analyze_property/run_campaign/connector.*) are
// registered later, where their dependencies exist. Mount with no demo handlers.
const thinga = mountCrmSubstrate(db);
const mirrorLeadSafe = (id) => {
  try { const row = db.prepare("SELECT * FROM leads WHERE id=?").get(id); if (row) mirrorLead(thinga, row); }
  catch (e) { console.error("thinga mirror (non-fatal):", e.message); }
};
// Connector registry (built at end of file once its injected deps are defined). executeCampaign
// fans over registry[<sources>] instead of calling RentCast directly. See connectors/.
let registry = {};
const mirrorTaskSafe = (id) => {
  try { const r = db.prepare("SELECT * FROM tasks WHERE id=?").get(id); if (r) mirrorTask(thinga, r); }
  catch (e) { console.error("thinga mirror task (non-fatal):", e.message); }
};
const mirrorNoteSafe = (day) => {
  try { const r = db.prepare("SELECT day, body FROM day_notes WHERE day=?").get(day); if (r) mirrorNote(thinga, r); }
  catch (e) { console.error("thinga mirror note (non-fatal):", e.message); }
};
const mirrorNotifSafe = (id) => {
  try { const r = db.prepare("SELECT * FROM notifications WHERE id=?").get(id); if (r) mirrorNotification(thinga, r); }
  catch (e) { console.error("thinga mirror notif (non-fatal):", e.message); }
};
const mirrorBuyerSafe = (id) => {
  try { const r = db.prepare("SELECT * FROM buyers WHERE id=?").get(id); if (r) mirrorBuyer(thinga, r); }
  catch (e) { console.error("thinga mirror buyer (non-fatal):", e.message); }
};
const mirrorTemplateSafe = (id) => {
  try { const r = db.prepare("SELECT * FROM templates WHERE id=?").get(id); if (r) mirrorTemplate(thinga, r); }
  catch (e) { console.error("thinga mirror template (non-fatal):", e.message); }
};
const mirrorPropertySafe = (id) => {
  try { const r = db.prepare("SELECT * FROM properties WHERE id=?").get(id); if (r) mirrorProperty(thinga, r); }
  catch (e) { console.error("thinga mirror property (non-fatal):", e.message); }
};
const mirrorCampaignSafe = (id) => {
  try { const r = db.prepare("SELECT * FROM campaigns WHERE id=?").get(id); if (r) mirrorCampaign(thinga, r); }
  catch (e) { console.error("thinga mirror campaign (non-fatal):", e.message); }
};
const mirrorSearchPlanSafe = (plan) => {
  try { if (plan) mirrorPlan(thinga, plan); }
  catch (e) { console.error("thinga mirror plan (non-fatal):", e.message); }
};
for (const plan of listSearchPlans()) mirrorSearchPlanSafe(plan);

function rowBuyerCandidate(row) {
  if (!row) return null;
  let evidence = {};
  try { evidence = JSON.parse(row.evidence_json || "{}"); } catch { evidence = {}; }
  return { ...row, evidence };
}

function mirrorBuyerCandidateSafe(row) {
  try {
    if (!row) return;
    thinga.put({
      id: `thinga:buyer-candidate-${row.id}`,
      kind: "buyerCandidate",
      name: row.name,
      schema: "buyerDiscovery.candidate.v1",
      category_path: row.imported_buyer_id ? "BuyerDiscovery/Imported" : "BuyerDiscovery/Candidates",
      links: row.imported_buyer_id ? [{ kind: "promoted_to", to: `thinga:buyer-${row.imported_buyer_id}` }] : [],
      content: {
        candidate_id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        areas: row.areas,
        property_types: row.property_types,
        max_price: row.max_price,
        cash: row.cash,
        source_id: row.source_id,
        source_type: row.source_type,
        confidence: row.confidence,
        parser_family: "buyerDiscovery.candidate.v1",
        evidence: row.evidence || {},
      },
      tags: [row.source_id, row.source_type, row.confidence].filter(Boolean),
    });
  } catch (e) { console.error("thinga mirror buyer candidate (non-fatal):", e.message); }
}

function saveBuyerCandidate(input = {}) {
  const c = normalizeBuyerCandidate(input);
  if (!c) throw new Error("buyer candidate requires a name");
  const existing = db.prepare(`SELECT * FROM buyer_discovery_candidates
    WHERE lower(name)=lower(?) AND coalesce(source_id,'')=coalesce(?,'')
      AND coalesce(phone,'')=coalesce(?,'') AND coalesce(email,'')=coalesce(?,'')
    ORDER BY id LIMIT 1`).get(c.name, c.source_id || "", c.phone || "", c.email || "");
  const t = now();
  let row;
  if (existing) {
    db.prepare(`UPDATE buyer_discovery_candidates SET updated_at=?, phone=?, email=?, areas=?, property_types=?,
        max_price=?, cash=?, source_type=?, confidence=?, evidence_json=? WHERE id=?`)
      .run(t, c.phone, c.email, c.areas, c.property_types, c.max_price, c.cash, c.source_type, c.confidence, JSON.stringify(c.evidence), existing.id);
    row = db.prepare("SELECT * FROM buyer_discovery_candidates WHERE id=?").get(existing.id);
  } else {
    const info = db.prepare(`INSERT INTO buyer_discovery_candidates
        (created_at, updated_at, name, phone, email, areas, property_types, max_price, cash, source_id, source_type, confidence, evidence_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(t, t, c.name, c.phone, c.email, c.areas, c.property_types, c.max_price, c.cash, c.source_id, c.source_type, c.confidence, JSON.stringify(c.evidence));
    row = db.prepare("SELECT * FROM buyer_discovery_candidates WHERE id=?").get(info.lastInsertRowid);
  }
  const out = rowBuyerCandidate(row);
  mirrorBuyerCandidateSafe(out);
  return out;
}

const buyerCandidateRows = () => db.prepare("SELECT * FROM buyer_discovery_candidates ORDER BY updated_at DESC").all().map(rowBuyerCandidate);

function rowSellerPriceEvidence(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data_json || "{}"); } catch { data = {}; }
  return { ...row, data };
}

function mirrorSellerPriceEvidenceSafe(row) {
  try {
    if (!row) return;
    const parent = row.record_type === "lead" ? `thinga:lead-${row.record_id}` :
      row.record_type === "property" ? `thinga:property-${row.record_id}` : null;
    thinga.put({
      id: `thinga:seller-price-evidence-${row.id}`,
      kind: "evidence",
      name: `seller price ${row.price}`,
      schema: "sellerPrice.evidence.v1",
      parents: parent ? [parent] : [],
      links: parent ? [{ kind: "seller_price_for", to: parent }] : [],
      category_path: `Evidence/SellerPrice/${row.confidence || "unknown"}`,
      content: {
        evidence_id: row.id,
        record_type: row.record_type,
        record_id: row.record_id,
        price: row.price,
        confidence: row.confidence,
        source: row.source,
        context: row.context,
        reason: row.reason,
        parser_family: "sellerPrice.evidence.v1",
        data: row.data || {},
      },
      tags: ["seller-price", row.confidence, row.record_type].filter(Boolean),
    });
  } catch (e) { console.error("thinga mirror seller price evidence (non-fatal):", e.message); }
}

function saveSellerPriceEvidence(recordType, recordId, evidence = {}) {
  if (!recordType || !recordId || !evidence.price) return null;
  const info = db.prepare(`INSERT OR IGNORE INTO seller_price_evidence
      (created_at, record_type, record_id, price, confidence, source, source_record_id, context, reason, data_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(now(), recordType, recordId, evidence.price, evidence.confidence || null, evidence.source || null,
      evidence.record_id == null ? null : String(evidence.record_id), evidence.context || null, evidence.reason || null, JSON.stringify(evidence));
  const row = db.prepare(`SELECT * FROM seller_price_evidence
    WHERE record_type=? AND record_id=? AND price=? AND coalesce(source,'')=coalesce(?,'')
      AND coalesce(source_record_id,'')=coalesce(?,'') AND coalesce(context,'')=coalesce(?,'')
    ORDER BY id DESC LIMIT 1`)
    .get(recordType, recordId, evidence.price, evidence.source || "", evidence.record_id == null ? "" : String(evidence.record_id), evidence.context || "");
  const out = rowSellerPriceEvidence(row);
  if (info.changes || out) mirrorSellerPriceEvidenceSafe(out);
  return out;
}

function storedSellerPriceEvidence(recordType, recordId) {
  return db.prepare(`SELECT * FROM seller_price_evidence WHERE record_type=? AND record_id=?
    ORDER BY CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, price ASC, id DESC`)
    .all(recordType, recordId).map(rowSellerPriceEvidence);
}

function extractLeadSellerPriceEvidence(leadId) {
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(leadId);
  if (!lead) return [];
  const texts = [];
  if (lead.notes) texts.push({ source: "lead.notes", record_id: lead.id, text: lead.notes });
  for (const a of db.prepare("SELECT id, body FROM activities WHERE lead_id=? ORDER BY created_at DESC LIMIT 50").all(leadId)) {
    if (a.body) texts.push({ source: "activity", record_id: a.id, text: a.body });
  }
  for (const e of db.prepare("SELECT id, subject, body, snippet FROM emails WHERE lead_id=? ORDER BY msg_date DESC LIMIT 50").all(leadId)) {
    const text = [e.subject, e.snippet, e.body].filter(Boolean).join("\n");
    if (text) texts.push({ source: "email", record_id: e.id, text });
  }
  const found = sellerPriceEvidenceFromRecord(lead, texts);
  return found.map((x) => saveSellerPriceEvidence("lead", lead.id, x)).filter(Boolean);
}

function extractPropertySellerPriceEvidence(propertyId) {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(propertyId);
  if (!p) return [];
  const found = sellerPriceEvidenceFromRecord({ ...p, asking_price: p.price }, []);
  return found.map((x) => saveSellerPriceEvidence("property", p.id, x)).filter(Boolean);
}

function bestStoredSellerPrice(recordType, recordId) {
  const stored = storedSellerPriceEvidence(recordType, recordId);
  return bestSellerPriceEvidence(stored.map((x) => ({ ...x, record_id: x.source_record_id })));
}

// ---------- Settings (key/value) ----------
const getSetting = (k) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
  return row ? row.value : null;
};
const setSetting = (k, v) => {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v ?? "");
  // mirror non-secret settings into the substrate (mirrorSetting skips passwords/api keys/tokens)
  try { mirrorSetting(thinga, k, v ?? ""); } catch (e) { console.error("thinga mirror setting (non-fatal):", e.message); }
};

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
  const at = now();
  const info = db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)")
    .run(leadId, at, type, body);
  try { mirrorActivity(thinga, { id: info.lastInsertRowid, lead_id: leadId, created_at: at, type, body }); }
  catch (e) { console.error("thinga mirror activity (non-fatal):", e.message); }
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
const batchdataKey = () => getSetting("batchdata_api_key") || process.env.BATCHDATA_API_KEY;
const googleMapsKey = () => getSetting("google_maps_api_key") || process.env.GOOGLE_MAPS_API_KEY;

// Reusable: skip-trace one address via BatchData. Returns { ok, phones, emails, error }.
async function skipTraceOne(addressStr) {
  const key = batchdataKey();
  if (!key) return { ok: false, error: "no_key", phones: [], emails: [] };
  if (!addressStr) return { ok: false, error: "no_address", phones: [], emails: [] };
  const ad = parseAddr(addressStr);
  try {
    const r = await fetch("https://api.batchdata.com/api/v1/property/skip-trace", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ requests: [{ propertyAddress: { street: ad.street, city: ad.city, state: ad.state, zip: ad.zip } }] }),
    });
    const text = await r.text();
    let jb; try { jb = JSON.parse(text); } catch { jb = { raw: text }; }
    if (!r.ok) return { ok: false, error: r.status === 401 ? "bad_key" : `http_${r.status}`, phones: [], emails: [] };
    const { phones, emails } = collectContacts(jb);
    return { ok: true, phones, emails };
  } catch (err) {
    return { ok: false, error: String(err.message || err), phones: [], emails: [] };
  }
}
// Apply a skip-trace result onto a lead row (fills phone/email if found), logs it.
function applySkipTrace(leadId, st) {
  const phone = st.phones[0] ? fmtPhone(st.phones[0]) : null;
  const email = st.emails[0] || null;
  const t = now();
  db.prepare(`UPDATE leads SET seller_phone=COALESCE(NULLIF(?,''), seller_phone),
      seller_email=COALESCE(NULLIF(?,''), seller_email), skiptraced_at=?, skiptrace_raw=?, updated_at=? WHERE id=?`)
    .run(phone || "", email || "", t, JSON.stringify({ phones: st.phones, emails: st.emails }), t, leadId);
  logActivity(leadId, "skiptrace", `Skip traced — ${st.phones.length} phone(s), ${st.emails.length} email(s) found.`);
  return { phone, email };
}

app.post("/api/leads/:id/skiptrace", async (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!batchdataKey()) return res.status(400).json({ error: "Connect BatchData first (Acquisitions → Connect skip tracing)." });
  if (!lead.address) return res.status(400).json({ error: "This lead has no address to skip trace." });
  const st = await skipTraceOne(lead.address);
  if (!st.ok) {
    const msg = st.error === "bad_key" ? "BatchData rejected the key — check it in Acquisitions." : "Skip trace failed: " + st.error;
    return res.status(502).json({ error: msg });
  }
  const { phone, email } = applySkipTrace(lead.id, st);
  mirrorLeadSafe(lead.id);
  res.json({ ok: true, phones: st.phones.map(fmtPhone), emails: st.emails, phone, email });
});

// Multi-route contact finder: try ALL free public-contact sources first, escalate only if empty.
// Goal-driven subsystem of the contact-pathfinding engine (free routes → paid → research agent).
app.post("/api/leads/:id/find-contact", async (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  try {
    const subject = {
      address: lead.address, owner_name: lead.seller_name, business_name: lead.seller_name,
      city: lead.city, state: lead.state, zip: lead.zip,
    };
    const result = await findContact(registry, subject, { batchdataKey: Boolean(batchdataKey()) });
    // If a free phone/email was found and the lead has none, fill it (never overwrite existing).
    const best = result.candidates.find((c) => c.phone) || result.candidates.find((c) => c.email);
    if (best) {
      db.prepare(`UPDATE leads SET seller_phone=COALESCE(NULLIF(seller_phone,''), ?),
          seller_email=COALESCE(NULLIF(seller_email,''), ?), updated_at=? WHERE id=?`)
        .run(best.phone || "", best.email || "", now(), lead.id);
      logActivity(lead.id, "note", `🔎 Contact route: ${result.freePhoneCount} free phone(s) via ${best.source_id} — ${best.phone || best.email} (${best.relation}, compliance unchecked)`);
      mirrorLeadSafe(lead.id);
    } else {
      logActivity(lead.id, "note", `🔎 Contact route: no free phone. Next: ${result.nextStep}`);
    }
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
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
  mirrorLeadSafe(id); // dual-write into the Thinga substrate (guarded)
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
  mirrorLeadSafe(req.params.id); // keep the substrate in sync (guarded)
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
  const tinfo = db.prepare("INSERT INTO tasks (lead_id, created_at, title, due_date, done) VALUES (?,?,?,?,0)")
    .run(req.params.id, now(), "Follow up", due);
  db.prepare("UPDATE leads SET next_followup = ?, updated_at = ? WHERE id = ?").run(due, now(), req.params.id);
  mirrorTaskSafe(tinfo.lastInsertRowid); // mirror the task into the substrate (guarded)
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
  mirrorLeadSafe(req.params.id); // keep the substrate in sync (guarded)
  res.json({ ok: true });
});

// --- Thinga substrate: read access (additive; the substrate mirrors leads → kind:lead/comps) ---
app.get("/api/thinga/:id", (req, res) => {
  const depth = Math.max(0, Math.min(5, Number(req.query.depth) || 0));
  const t = thinga.get(req.params.id, depth);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});
app.get("/api/thinga", (req, res) => {
  const kind = req.query.kind || undefined;
  res.json({ items: thinga.query(null, kind ? { kind } : {}) });
});
// A lead's substrate children — its activities + threaded messages — via the reverse-link index.
app.get("/api/thinga/lead/:leadId/children", (req, res) => {
  res.json({ items: childrenOfLead(thinga, Number(req.params.leadId)) });
});
// INVOKE a code Thinga (verbs→INVOKE): e.g. POST /api/thinga/thinga:code-score/invoke {propertyId}.
app.post("/api/thinga/:id/invoke", async (req, res) => {
  try {
    const result = await thinga.invoke(req.params.id, req.body || {});
    res.json({ ok: true, result });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
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
  mirrorTaskSafe(info.lastInsertRowid); // guarded substrate mirror
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
  mirrorTaskSafe(req.params.id); // keep the substrate in sync (guarded)
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
  const md = msg_date || now();
  try {
    const info = db.prepare(`INSERT INTO emails (lead_id, direction, from_name, from_addr, to_addr, subject, body, snippet, msg_date, uid, read, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(lead_id, direction, from_name, from_addr, to_addr, subject, body, snippet, md, uid, read, now());
    try { mirrorEmail(thinga, { id: info.lastInsertRowid, lead_id, direction, subject, snippet, from_addr, to_addr, msg_date: md }); }
    catch (e) { console.error("thinga mirror email (non-fatal):", e.message); }
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
  if (!body) {
    db.prepare("DELETE FROM day_notes WHERE day=?").run(req.params.day);
    try { thinga.tombstone(`thinga:note-${req.params.day}`); } catch { /* non-fatal */ }
    return res.json({ ok: true, deleted: true });
  }
  db.prepare(`INSERT INTO day_notes (day, body, updated_at) VALUES (?,?,?)
    ON CONFLICT(day) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`).run(req.params.day, body, now());
  mirrorNoteSafe(req.params.day); // guarded substrate mirror
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
  if (added > 0) {
    const ni = db.prepare("INSERT INTO notifications (created_at, type, title, body, read) VALUES (?,?,?,?,0)")
      .run(now(), "inbox", `📥 ${added} new email${added === 1 ? "" : "s"}`, "New mail landed in your inbox.");
    mirrorNotifSafe(ni.lastInsertRowid); // guarded substrate mirror
  }
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
setInterval(safeTick("inbox-sync", autoSyncInbox), 10 * 60 * 1000); // every 10 minutes
setTimeout(safeTick("inbox-sync", autoSyncInbox), 15 * 1000); // and shortly after startup

// --- Templates ---
app.get("/api/templates", (req, res) => {
  res.json(db.prepare("SELECT * FROM templates ORDER BY audience, name").all());
});
app.post("/api/templates", (req, res) => {
  const { name, subject, body, audience } = req.body || {};
  const info = db.prepare("INSERT INTO templates (created_at, name, subject, body, audience) VALUES (?,?,?,?,?)")
    .run(now(), name || "Untitled", subject || "", body || "", audience || "leads");
  mirrorTemplateSafe(info.lastInsertRowid); // guarded substrate mirror
  res.json({ id: info.lastInsertRowid });
});
app.put("/api/templates/:id", (req, res) => {
  const { name, subject, body, audience } = req.body || {};
  db.prepare("UPDATE templates SET name=?, subject=?, body=?, audience=? WHERE id=?")
    .run(name, subject, body, audience || "leads", req.params.id);
  mirrorTemplateSafe(req.params.id); // guarded substrate mirror
  res.json({ ok: true });
});
app.delete("/api/templates/:id", (req, res) => {
  db.prepare("DELETE FROM templates WHERE id=?").run(req.params.id);
  try { thinga.tombstone(`thinga:template-${req.params.id}`); } catch { /* non-fatal */ }
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
  mirrorBuyerSafe(info.lastInsertRowid); // guarded substrate mirror
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/buyers/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE buyers SET ${BUYER_FIELDS.map((f) => `${f} = ?`).join(",")} WHERE id = ?`)
    .run(...BUYER_FIELDS.map((f) => (b[f] === undefined || b[f] === "" ? null : b[f])), req.params.id);
  mirrorBuyerSafe(req.params.id); // guarded substrate mirror
  res.json({ ok: true });
});

app.delete("/api/buyers/:id", (req, res) => {
  db.prepare("DELETE FROM buyers WHERE id = ?").run(req.params.id);
  try { thinga.tombstone(`thinga:buyer-${req.params.id}`); } catch { /* non-fatal */ }
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
// Liveness probe for embedders (ankhor88 ProgramThingaCard polls this for its
// status dot). No auth, no data — just "the CRM is up".
app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "wholesale-crm", at: new Date().toISOString() });
});

// The generic parser's button-click entry point: memory first, detect on miss,
// remember the outcome (parse_memory.js). POST a raw record, get back which
// registered kind parses it and whether that came from memory or detection.
app.post("/api/parse/resolve", (req, res) => {
  try {
    const record = req.body && typeof req.body === "object" ? req.body : {};
    if (!Object.keys(record).length) return res.status(400).json({ error: "POST a JSON record to resolve" });
    const r = parseMemory.resolve(record);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.get("/api/parse/memory", (req, res) => {
  try { res.json({ stats: parseMemory.stats() }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
// Operator corrections: pin a shape to a kind (overrides detection), or forget
// a memory so the next resolve re-detects. Body: { record?|signature?, kind }.
app.post("/api/parse/remember", (req, res) => {
  try {
    const b = req.body || {};
    const signature = b.signature || (b.record && typeof b.record === "object" ? signatureOf(b.record) : null);
    if (!signature) return res.status(400).json({ error: "need signature or record" });
    if (!b.kind) return res.status(400).json({ error: "need kind (the parser to pin)" });
    res.json({ ok: true, ...parseMemory.remember(signature, String(b.kind), { pinned: true, by: "operator" }) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post("/api/parse/forget", (req, res) => {
  try {
    const b = req.body || {};
    const signature = b.signature || (b.record && typeof b.record === "object" ? signatureOf(b.record) : null);
    if (!signature) return res.status(400).json({ error: "need signature or record" });
    parseMemory.forget(signature);
    res.json({ ok: true, signature, forgotten: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ---------- ankhor88 live bridge: ThingaImportV2 over HTTP ----------
// ankhor's Smart Import auto-detects this document ($schema ThingaImportV2 —
// ankhor88_remix/src/utils/importSchemas/registry.ts detectSchema). Serving it
// live means import-from-URL instead of file shuffling. Contacts are ALWAYS
// redacted on this route: HTTP surface, no DNC/consent gate on the other side
// (--with-contacts exists only on the operator CLI exporter).
app.get("/api/export/ankhor-import", (req, res) => {
  try {
    const kinds = String(req.query.kinds || "lead,property,buyer,campaign,plan,note,task").split(",").map((s) => s.trim()).filter(Boolean);
    const limitPerKind = Math.max(1, Math.min(2000, Number(req.query.limit_per_kind) || 200));
    const rows = [];
    for (const kind of kinds) {
      if (kind === "setting") continue;
      rows.push(...db.prepare("SELECT id, kind, name, version, content, axes, category_path FROM thingas WHERE kind = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(kind, limitPerKind));
    }
    res.json(buildThingaImportV2(rows, { withContacts: false }));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ---------- DNC verdicts: store + query check results (audit P1 #2) ----------
// A verdict comes from a real check (list lookup, provider, documented manual
// check) and MUST name its source. A stored fresh "clear" is what flips the
// queue's dnc_consent_missing blocker; stale clears degrade to unchecked.
app.post("/api/dnc/record", (req, res) => {
  const r = dncStore.record(req.body || {});
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(r);
});
app.get("/api/dnc/status", (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.json({ stats: dncStore.stats() });
  const hit = dncStore.lookup(phone);
  res.json({ phone: normalizePhone(phone), record: hit, effective_status: hit ? hit.effective_status : null });
});

// ---------- Call outcomes: what happened after the dial (audit P1 #4) ----------
app.post("/api/pro-queue/:propertyId/call-outcome", (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) return res.status(400).json({ error: "bad propertyId" });
  const prop = db.prepare("SELECT id FROM properties WHERE id = ?").get(propertyId);
  if (!prop) return res.status(404).json({ error: "property not found" });
  const norm = normalizeCallOutcome(req.body || {});
  if (!norm.ok) return res.status(400).json({ error: norm.error });
  const r = norm.record;
  const oInfo = db.prepare(`INSERT INTO call_outcomes (property_id, created_at, outcome, next_action, seller_price, offer_amount, follow_up_date, outreach_suppressed, notes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(propertyId, new Date().toISOString(), r.outcome, r.next_action,
    r.seller_price, r.offer_amount, r.follow_up_date, r.outreach_suppressed ? 1 : 0, r.notes);
  // One graph: the outcome becomes a child Thinga of the property (same
  // containment pattern as activities -> leads in crm_thinga.js).
  try {
    thinga.put({
      id: `thinga:call_outcome-${Number(oInfo.lastInsertRowid)}`,
      kind: "call_outcome",
      name: r.outcome,
      parents: [`thinga:property-${propertyId}`],
      content: { crm_id: Number(oInfo.lastInsertRowid), property_id: propertyId, outcome: r.outcome,
        next_action: r.next_action, seller_price: r.seller_price, offer_amount: r.offer_amount,
        follow_up_date: r.follow_up_date, outreach_suppressed: r.outreach_suppressed },
    });
  } catch (e) { console.warn("[call-outcome] thinga mirror skipped:", e.message); }
  // A named seller price is evidence — persist it so spread/proof can use it.
  if (r.seller_price != null) {
    try { db.prepare("UPDATE properties SET asking_price = COALESCE(asking_price, ?) WHERE id = ?").run(r.seller_price, propertyId); }
    catch { /* schema without asking_price — outcome row still holds it */ }
  }
  const rows = db.prepare("SELECT * FROM call_outcomes WHERE property_id = ? ORDER BY id DESC").all(propertyId);
  res.json({ ok: true, recorded: r, summary: summarizeOutcomes(rows) });
});

app.get("/api/pro-queue/:propertyId/call-outcomes", (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) return res.status(400).json({ error: "bad propertyId" });
  const rows = db.prepare("SELECT * FROM call_outcomes WHERE property_id = ? ORDER BY id DESC").all(propertyId);
  res.json({ outcomes: rows, summary: summarizeOutcomes(rows) });
});

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
  // Property call follow-ups (call_outcomes.follow_up_date): the LATEST outcome
  // per property decides; due today/overdue; suppressed properties never appear.
  let callFollowups = [];
  try {
    callFollowups = db.prepare(`
      SELECT co.property_id, co.follow_up_date, co.outcome, p.address, p.formatted_address, p.city
      FROM call_outcomes co
      JOIN properties p ON p.id = co.property_id
      WHERE co.id IN (SELECT MAX(id) FROM call_outcomes GROUP BY property_id)
        AND co.follow_up_date IS NOT NULL AND co.follow_up_date <= ?
        AND co.property_id NOT IN (SELECT property_id FROM call_outcomes WHERE outreach_suppressed = 1)
      ORDER BY co.follow_up_date ASC LIMIT 50`).all(today);
  } catch { /* call_outcomes not created yet */ }
  // Last standing-watch round (tools/watch_round.mjs --log) — surfaces the
  // autonomous health trace on the dashboard. Absent file = watch never run.
  let watchLast = null;
  try {
    const lines = readFileSync(join(__dirname, "logs", "watch.log"), "utf8").trim().split("\n");
    watchLast = lines[lines.length - 1] || null;
  } catch { /* no log yet */ }
  res.json({ stages, totals, followups, callFollowups, today, offersToday, offersTarget: 5, prospects, watchLast });
});

// ====================== ACQUISITIONS — Phase 1 ======================
// `sources` = comma-separated connector ids the campaign fans over (default rentcast-sale).
try { db.exec("ALTER TABLE campaigns ADD COLUMN sources TEXT"); } catch { /* already exists */ }
const CAMPAIGN_FIELDS = ["name", "active", "city", "state", "zip", "property_type", "status",
  "price_min", "price_max", "beds_min", "baths_min", "sqft_min", "days_on_market_min", "sources"];

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
    googleMapsConnected: Boolean(googleMapsKey()),
    ...acqConfig(),
  });
});
app.post("/api/acq/settings", (req, res) => {
  const b = req.body || {};
  if (b.rentcast_api_key) setSetting("rentcast_api_key", String(b.rentcast_api_key).trim());
  if (b.anthropic_api_key) setSetting("anthropic_api_key", String(b.anthropic_api_key).trim());
  if (b.batchdata_api_key) setSetting("batchdata_api_key", String(b.batchdata_api_key).trim());
  if (b.google_maps_api_key) setSetting("google_maps_api_key", String(b.google_maps_api_key).trim());
  for (const k of ["rehab_per_sqft", "buyer_pct", "min_fee", "min_score", "auto_scan_hours", "hot_score"]) {
    if (b[k] !== undefined && b[k] !== "") setSetting(k, String(b[k]));
  }
  if (b.email_alerts !== undefined) setSetting("email_alerts", b.email_alerts ? "1" : "0");
  res.json({
    ok: true,
    rentcastConnected: Boolean(getSetting("rentcast_api_key")),
    googleMapsConnected: Boolean(googleMapsKey()),
    ...acqConfig(),
  });
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
  mirrorCampaignSafe(info.lastInsertRowid); // campaign → code Thinga (guarded)
  res.json({ id: info.lastInsertRowid });
});
app.put("/api/campaigns/:id", (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE campaigns SET ${CAMPAIGN_FIELDS.map((f) => `${f}=?`).join(",")} WHERE id=?`)
    .run(...CAMPAIGN_FIELDS.map((f) => (f === "active" ? (b[f] ? 1 : 0) : (b[f] === undefined || b[f] === "" ? null : b[f]))), req.params.id);
  mirrorCampaignSafe(req.params.id); // keep the campaign Thinga in sync (guarded)
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id", (req, res) => {
  db.prepare("DELETE FROM campaigns WHERE id=?").run(req.params.id);
  try { thinga.tombstone(`thinga:campaign-${req.params.id}`); } catch { /* non-fatal */ }
  res.json({ ok: true });
});

// Run a campaign — fan over its connector sources, dedup into the property store.
async function executeCampaign(c) {
  // Fan over listings-type connectors named in the campaign's `sources` (default rentcast-sale).
  const sourceIds = (c.sources || "rentcast-sale").split(",").map((s) => s.trim()).filter(Boolean);
  const arr = [];
  for (const sid of sourceIds) {
    const conn = registry[sid];
    if (!conn || conn.type !== "listings") continue; // campaign scan = on-market listings sources
    try { arr.push(...await conn.search(c)); }
    catch (e) { console.error(`connector ${sid} failed:`, e.message); } // one source failing never kills the run
  }
  const hotScore = Number(getSetting("hot_score")) || 60;
  let neu = 0, upd = 0; const newHotIds = []; const t = now();
  {
    for (const vals of arr) {
      // campaign numeric filters, applied uniformly on the normalized shape
      if (c.price_min && vals.price && vals.price < c.price_min) continue;
      if (c.price_max && vals.price && vals.price > c.price_max) continue;
      if (c.beds_min && vals.bedrooms && vals.bedrooms < c.beds_min) continue;
      if (c.baths_min && vals.bathrooms && vals.bathrooms < c.baths_min) continue;
      if (c.sqft_min && vals.square_footage && vals.square_footage < c.sqft_min) continue;
      if (!vals.addr_key) continue;
      vals.last_seen = t; vals.campaign_id = c.id;
      const existing = db.prepare("SELECT id, wholesale_score FROM properties WHERE addr_key=?").get(vals.addr_key);
      const sc = scoreListing(vals);
      vals.motivation_score = sc.motivation;
      vals.distress_score = sc.distress;
      vals.lead_score = sc.lead;
      if (existing) {
        const lead = blendLead(sc, existing.wholesale_score);
        db.prepare(`UPDATE properties SET updated_at=?, last_seen=?, status=?, price=?, days_on_market=?, price_history=?, campaign_id=?, motivation_score=?, distress_score=?, lead_score=?, listing_agent_name=?, listing_agent_phone=?, listing_agent_email=? WHERE id=?`)
          .run(t, t, vals.status, vals.price, vals.days_on_market, vals.price_history, c.id, sc.motivation, sc.distress, lead, vals.listing_agent_name, vals.listing_agent_phone, vals.listing_agent_email, existing.id);
        mirrorPropertySafe(existing.id); // guarded substrate mirror
        upd++;
      } else {
        const cols = Object.keys(vals);
        const info = db.prepare(`INSERT INTO properties (created_at, updated_at, ${cols.join(",")}) VALUES (?,?, ${cols.map(() => "?").join(",")})`)
          .run(t, t, ...cols.map((k) => vals[k]));
        mirrorPropertySafe(info.lastInsertRowid); // guarded substrate mirror
        neu++;
        if (sc.lead >= hotScore) newHotIds.push(info.lastInsertRowid);
      }
    }
  }
  db.prepare("UPDATE campaigns SET last_run=?, last_count=? WHERE id=?").run(t, arr.length, c.id);
  mirrorCampaignSafe(c.id); // refresh the campaign Thinga (last_run/last_count)
  return { found: arr.length, neu, upd, newHotIds };
}

// The campaign code Thinga's run handler — INVOKE thinga:campaign-N executes the campaign.
thinga.registerHandler("run_campaign", async (t) => {
  const c = db.prepare("SELECT * FROM campaigns WHERE id=?").get(t.content && t.content.crm_id);
  return c ? await executeCampaign(c) : { error: "campaign not found" };
});

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
    mirrorNotifSafe(info.lastInsertRowid); // guarded substrate mirror
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
setInterval(safeTick("auto-scan", maybeAutoScan), 60 * 60 * 1000); // check hourly
setTimeout(safeTick("auto-scan", maybeAutoScan), 45 * 1000);        // and shortly after startup

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

function storePropertyEvidence(propertyId, evidence) {
  const status = evidence.error || evidence.street_view?.metadata?.status || "OK";
  const summary = [
    evidence.street_view?.available ? "street_view" : null,
    evidence.satellite?.available ? "satellite" : null,
    evidence.parcel_overlay?.status === "county_geometry_overlayed" ? "parcel_overlay" : null,
  ].filter(Boolean).join(", ") || status;
  const info = db.prepare(`INSERT INTO property_evidence
      (property_id, created_at, source_id, evidence_type, status, summary, data_json)
      VALUES (?,?,?,?,?,?,?)`)
    .run(propertyId, now(), evidence.source_id || "unknown", evidence.source_type || "evidence",
      status, summary, JSON.stringify(evidence));
  try {
    thinga.put({
      id: `thinga:property-evidence-${info.lastInsertRowid}`,
      kind: "evidence",
      name: `${evidence.source_type || "evidence"} for property ${propertyId}`,
      parents: [`thinga:property-${propertyId}`],
      links: [{ kind: "evidence_for", to: `thinga:property-${propertyId}` }],
      category_path: "Evidence/PropertyImagery",
      content: { crm_id: info.lastInsertRowid, property_id: propertyId, ...evidence },
    });
  } catch (e) { console.error("thinga evidence mirror (non-fatal):", e.message); }
  return { id: info.lastInsertRowid, summary, status };
}

app.get("/api/properties/:id/evidence", (req, res) => {
  const p = db.prepare("SELECT id FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  const rows = db.prepare(`SELECT id, created_at, source_id, evidence_type, status, summary, data_json
    FROM property_evidence WHERE property_id=? ORDER BY created_at DESC LIMIT 20`).all(req.params.id);
  res.json({ items: rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })) });
});

app.post("/api/properties/:id/imagery", async (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  try {
    const evidence = await buildPropertyImageryEvidence(p, { googleMapsKey: googleMapsKey() });
    const stored = storePropertyEvidence(p.id, evidence);
    res.json({ ok: !evidence.error, stored, evidence });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get("/api/properties/:id/buyer-matches", (req, res) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  const rows = db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all();
  const demand = rankBuyerDemand({
    property: p,
    crmBuyers: rows,
    discoveredCandidates: buyerCandidateRows(),
    limit: Number(req.query.limit) || 20,
  });
  res.json({ property_id: p.id, matches: demand.all, existing: demand.existing, discovered: demand.discovered, gaps: demand.gaps, discovery_paths: demand.discovery_paths });
});

app.get("/api/buyer-discovery/candidates", (_req, res) => {
  res.json({ candidates: buyerCandidateRows(), source_families: BUYER_DISCOVERY_SOURCE_FAMILIES });
});

app.post("/api/buyer-discovery/candidates", (req, res) => {
  try {
    res.json({ ok: true, candidate: saveBuyerCandidate(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/buyer-discovery/candidates/:id/promote", (req, res) => {
  const c = rowBuyerCandidate(db.prepare("SELECT * FROM buyer_discovery_candidates WHERE id=?").get(req.params.id));
  if (!c) return res.status(404).json({ error: "candidate not found" });
  const info = db.prepare(`INSERT INTO buyers (created_at, name, phone, email, areas, property_types, max_price, cash, notes)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(now(), c.name, c.phone, c.email, c.areas, c.property_types, c.max_price, c.cash ?? 1,
      `Promoted from buyer discovery source ${c.source_id || "unknown"}.\nEvidence: ${JSON.stringify(c.evidence || {})}`);
  db.prepare("UPDATE buyer_discovery_candidates SET imported_buyer_id=?, updated_at=? WHERE id=?").run(info.lastInsertRowid, now(), c.id);
  mirrorBuyerSafe(info.lastInsertRowid);
  const updated = rowBuyerCandidate(db.prepare("SELECT * FROM buyer_discovery_candidates WHERE id=?").get(c.id));
  mirrorBuyerCandidateSafe(updated);
  res.json({ ok: true, buyerId: info.lastInsertRowid, candidate: updated });
});

// BULK promotion behind the quality gate (audit P5: 291 candidates, ~2 active
// buyers — one-by-one promotion is why). Dry-run by default; pass apply:true
// to write. Dedupes case-insensitively against existing buyers by name.
app.post("/api/buyer-discovery/promote-qualified", (req, res) => {
  const b = req.body || {};
  const opts = { minConfidence: b.minConfidence || "high", requireCash: b.requireCash !== false };
  const limit = Math.max(1, Math.min(1000, Number(b.limit) || 500));
  const apply = b.apply === true;
  const existing = new Set(db.prepare("SELECT LOWER(TRIM(name)) n FROM buyers").all().map((r) => r.n));
  const candidates = db.prepare("SELECT * FROM buyer_discovery_candidates WHERE imported_buyer_id IS NULL ORDER BY id LIMIT ?").all(limit * 3);
  const promoted = [], skipped = [];
  for (const raw of candidates) {
    if (promoted.length >= limit) break;
    const c = rowBuyerCandidate(raw);
    const q = qualifiesForPromotion(c, opts);
    if (!q.ok) { skipped.push({ id: c.id, name: c.name, reason: q.reason }); continue; }
    const nameKey = String(c.name || "").toLowerCase().trim();
    if (existing.has(nameKey)) { skipped.push({ id: c.id, name: c.name, reason: "duplicate of existing buyer" }); continue; }
    if (apply) {
      const info = db.prepare(`INSERT INTO buyers (created_at, name, phone, email, areas, property_types, max_price, cash, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(now(), c.name, c.phone, c.email, c.areas, c.property_types, c.max_price, c.cash ?? 1,
          `Bulk-promoted (gate: confidence>=${opts.minConfidence}, cash=${opts.requireCash}) from ${c.source_id || "unknown"}.`);
      db.prepare("UPDATE buyer_discovery_candidates SET imported_buyer_id=?, updated_at=? WHERE id=?").run(info.lastInsertRowid, now(), c.id);
      mirrorBuyerSafe(info.lastInsertRowid);
      promoted.push({ id: c.id, name: c.name, buyerId: Number(info.lastInsertRowid) });
    } else {
      promoted.push({ id: c.id, name: c.name, buyerId: null });
    }
    existing.add(nameKey);
  }
  res.json({ applied: apply, would_promote: !apply ? promoted.length : undefined, promoted: apply ? promoted.length : undefined,
    skipped: skipped.length, promoted_list: promoted.slice(0, 50), skip_reasons: Object.entries(skipped.reduce((m, s) => (m[s.reason] = (m[s.reason] || 0) + 1, m), {})) });
});

app.get("/api/seller-price/evidence", (req, res) => {
  const recordType = req.query.recordType || null;
  const recordId = req.query.recordId ? Number(req.query.recordId) : null;
  let rows;
  if (recordType && recordId) rows = storedSellerPriceEvidence(recordType, recordId);
  else rows = db.prepare("SELECT * FROM seller_price_evidence ORDER BY created_at DESC LIMIT 500").all().map(rowSellerPriceEvidence);
  res.json({ items: rows });
});

app.post("/api/seller-price/extract", (req, res) => {
  const b = req.body || {};
  const limit = Math.max(1, Math.min(5000, Number(b.limit) || 2000));
  let extracted = 0;
  const leads = b.recordType === "property" ? [] :
    db.prepare("SELECT id FROM leads ORDER BY updated_at DESC LIMIT ?").all(limit);
  for (const l of leads) extracted += extractLeadSellerPriceEvidence(l.id).length;
  const props = b.recordType === "lead" ? [] :
    db.prepare("SELECT id FROM properties ORDER BY updated_at DESC LIMIT ?").all(limit);
  for (const p of props) extracted += extractPropertySellerPriceEvidence(p.id).length;
  res.json({ ok: true, extracted, totalEvidence: db.prepare("SELECT COUNT(*) n FROM seller_price_evidence").get().n });
});

// Pro wholesaler queue — read-only view of the tiered, enriched work list
// (built by tools/build_pro_queue.mjs --persist). Optional ?tier= and ?limit=.
// ContactRouteEngine: plan the shortest LEGAL path to a contact for a property, and gate any
// supplied candidate. Read-only planning — it does NOT call any paid API. Body: { property_id }
// or { node }, optional { goal, channels, candidate }.
// First-party seller lead: a seller submits their own info + explicit opt-in (landing page).
// This is the cleanest contact route — express consent records a lawful basis and can flip
// outreach_allowed:true on the consented channels WITHOUT paid skip-trace.
app.post("/api/seller-lead", (req, res) => {
  try {
    const consent = makeConsentRecord(req.body || {});
    if (!consent.valid) return res.status(400).json({ ok: false, error: consent.reason });
    db.exec(`CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, name TEXT, phone TEXT,
      email TEXT, address TEXT, channels TEXT, source TEXT, offer TEXT, legal_basis TEXT)`);
    db.prepare(`INSERT INTO consent_records (created_at,name,phone,email,address,channels,source,offer,legal_basis)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(consent.timestamp, consent.name, consent.phone, consent.email,
      consent.address, JSON.stringify(consent.channels), consent.source, consent.offer, consent.legal_basis);
    const compliance = complianceCheck(consentToContactCandidate(consent), { channels: consent.channels });
    res.json({
      ok: true,
      consent: { name: consent.name, channels: consent.channels, legal_basis: consent.legal_basis },
      outreach_allowed: compliance.outreach_allowed,
      allowed_channels: compliance.allowed_channels,
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// Seller intake queue -- read-only view over first-party consent records. This is
// internal/operator-facing and may include the seller-provided contact fields, unlike
// the investor marketplace which keeps seller contact redacted.
app.get("/api/seller-intake/leads", (req, res) => {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, name TEXT, phone TEXT,
      email TEXT, address TEXT, channels TEXT, source TEXT, offer TEXT, legal_basis TEXT)`);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const rows = db.prepare(`SELECT id, created_at, name, phone, email, address, channels, source, offer, legal_basis
      FROM consent_records ORDER BY created_at DESC LIMIT ?`).all(limit);
    res.json(buildSellerIntakeQueue({ consentRecords: rows, limit }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Seller promotion workflow -- internal read model that links first-party consent
// leads to existing property proof stacks when the seller-submitted address matches.
// This keeps seller contact inside intake while the buyer marketplace remains redacted.
app.get("/api/seller-intake/promotions", (req, res) => {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, name TEXT, phone TEXT,
      email TEXT, address TEXT, channels TEXT, source TEXT, offer TEXT, legal_basis TEXT)`);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const rows = db.prepare(`SELECT id, created_at, name, phone, email, address, channels, source, offer, legal_basis
      FROM consent_records ORDER BY created_at DESC LIMIT ?`).all(limit);
    const properties = db.prepare(`SELECT id, formatted_address, address, city, state, zip, source,
        lead_score, distress_score, wholesale_score, updated_at
      FROM properties
      WHERE address IS NOT NULL OR formatted_address IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 20000`).all();
    res.json(buildSellerPromotionWorkflow({ consentRecords: rows, properties, limit }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Skip-trace a pro-queue PROPERTY (the 321 ready leads live here, not in `leads`). Runs the spend
// gate first; only spends when approved AND a BatchData key is set. Any number found is stored as
// the property's contact but stays outreach_allowed:false until DNC/consent clears (compliance gate).
app.post("/api/pro-queue/:propertyId/skiptrace", async (req, res) => {
  try {
    const id = Number(req.params.propertyId);
    const p = db.prepare("SELECT * FROM properties WHERE id = ?").get(id);
    if (!p) return res.status(404).json({ error: "property not found" });
    // A do_not_call outcome is absolute: never spend money finding a contact
    // for a seller who refused contact (call_outcome.js / outreach_suppressed).
    try {
      const sup = db.prepare("SELECT COUNT(*) c FROM call_outcomes WHERE property_id = ? AND outreach_suppressed = 1").get(id);
      if (sup && sup.c > 0) return res.status(403).json({ ok: false, allowed: false, spent: false, reason: "outreach permanently suppressed (do_not_call recorded) — skip-trace refused" });
    } catch { /* call_outcomes table absent */ }
    const q = db.prepare("SELECT tier, signals_json FROM pro_queue WHERE property_id = ?").get(id);
    let signals = {}; try { signals = JSON.parse(q?.signals_json || "{}"); } catch { signals = {}; }
    const decision = skiptraceDecision(
      { owner_name: p.owner_name, owner_mailing: p.owner_mailing, address: p.address || p.formatted_address },
      { tier: q?.tier, signals },
    );
    if (!decision.allowed) return res.json({ ok: true, allowed: false, spent: false, reason: decision.reason });

    const st = await skipTraceOne(p.address || p.formatted_address);
    if (st.error === "no_key") {
      return res.json({ ok: true, allowed: true, spent: false, reason: "approved for skip-trace — add a BatchData key (Settings → Acquisitions) to spend", skiptrace_input: decision.skiptrace_input });
    }
    if (!st.ok) return res.json({ ok: true, allowed: true, spent: false, reason: st.error || "skip-trace failed", skiptrace_input: decision.skiptrace_input });

    const phone = st.phones[0] || null, email = st.emails[0] || null;
    if (phone || email) {
      db.prepare("UPDATE properties SET listing_agent_phone = COALESCE(?, listing_agent_phone), listing_agent_email = COALESCE(?, listing_agent_email), updated_at = ? WHERE id = ?")
        .run(phone, email, now(), id);
    }
    const compliance = complianceCheck({ phone, email, dnc_status: "" }, { channels: ["call", "sms"] });
    res.json({
      ok: true, allowed: true, spent: true, max_cost: decision.max_cost,
      phones: st.phones, emails: st.emails,
      outreach_allowed: compliance.outreach_allowed, // false: DNC/consent not yet checked
      compliance_note: "number found but outreach_allowed stays false until DNC/consent is verified",
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post("/api/resolve/contact-route", (req, res) => {
  try {
    const b = req.body || {};
    let node = b.node;
    if (!node && b.property_id) {
      const p = db.prepare("SELECT id, address, formatted_address, owner_name, owner_mailing FROM properties WHERE id=?").get(b.property_id);
      if (!p) return res.status(404).json({ error: "property not found" });
      node = { id: `property:${p.id}`, kind: "property", source: "crm", fields: { address: p.address || p.formatted_address, owner_name: p.owner_name, mailing_address: p.owner_mailing } };
    }
    if (!node) return res.status(400).json({ error: "provide node or property_id" });
    res.json(resolveContactRoute({
      node, goal: b.goal || "phone",
      hasKeys: { batchdata_api_key: Boolean(batchdataKey()) },
      channels: b.channels, candidate: b.candidate || null,
    }));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get("/api/pro-queue", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 100));
    // Post-processing filters (all optional). `tier` accepts a CSV for multi-select
    // (e.g. tier=call_now,pay_to_unlock). SQL handles tier/score/grade/owner; the
    // signal-derived filters (distress/spread/owner-type/ready) run in JS over the
    // parsed signals so we never have to query inside signals_json.
    const tiers = String(req.query.tier || "").split(",").map((t) => t.trim()).filter(Boolean);
    const minScore = req.query.min_score != null ? Number(req.query.min_score) : null;
    const minGrade = req.query.min_grade != null ? Number(req.query.min_grade) : null;
    const ownerKnown = req.query.owner_known === "1";
    const wantReady = req.query.ready === "1";
    const wantDistress = req.query.distress === "1";
    const spreadWant = req.query.spread || null;   // works | thin | fails | unproven
    const signalWant = req.query.signal || null;   // absentee | entity | institutional
    // Several columns are optional/additive across DB vintages (property_grade from
    // the grade stage; asking_price/contract_price/offer_amount aren't in every
    // schema). Reference each only if it exists, else alias NULL, so a column that
    // isn't present can never 503 the whole endpoint.
    const pcols = new Set(db.prepare("SELECT name FROM pragma_table_info('properties')").all().map((r) => r.name));
    const optCol = (c) => (pcols.has(c) ? `p.${c}` : `NULL AS ${c}`);
    const hasGrade = pcols.has("property_grade");

    const where = [];
    const params = [];
    if (tiers.length) { where.push(`q.tier IN (${tiers.map(() => "?").join(",")})`); params.push(...tiers); }
    if (minScore != null && !Number.isNaN(minScore)) { where.push("q.priority_score >= ?"); params.push(minScore); }
    if (ownerKnown) where.push("p.owner_name IS NOT NULL AND TRIM(p.owner_name) <> ''");
    if (hasGrade && minGrade != null && !Number.isNaN(minGrade)) { where.push("p.property_grade >= ?"); params.push(minGrade); }

    // Contact + seller-price columns are pulled only to COMPUTE the call_now blockers
    // (why_not_call_now); they are destructured OUT of the response so the payload
    // shape is unchanged and the seller phone/email is never exposed here.
    const rows = db.prepare(`SELECT q.tier, q.priority_score, q.next_action, q.spend_allowed, q.signals_json,
        p.id AS property_id, p.address, p.formatted_address, p.city, p.state, p.county, p.source,
        p.owner_name, p.owner_mailing, p.arv, p.mao, ${optCol("property_grade")},
        ${optCol("listing_agent_phone")}, ${optCol("listing_agent_email")}, ${optCol("asking_price")}, ${optCol("contract_price")}, ${optCol("price")}, ${optCol("offer_amount")}
      FROM pro_queue q JOIN properties p ON p.id = q.property_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY CASE q.tier WHEN 'call_now' THEN 0 WHEN 'pay_to_unlock' THEN 1 WHEN 'research' THEN 2 ELSE 3 END, q.priority_score DESC
      LIMIT 2000`).all(...params);
    const counts = Object.fromEntries(db.prepare("SELECT tier, COUNT(*) c FROM pro_queue GROUP BY tier").all().map((r) => [r.tier, r.c]));
    // A do_not_call outcome anywhere in a property's history suppresses it forever
    // (call_outcomes.outreach_suppressed) — enforced here, not just recorded.
    let suppressed = new Set();
    try { suppressed = new Set(db.prepare("SELECT DISTINCT property_id FROM call_outcomes WHERE outreach_suppressed = 1").all().map((x) => x.property_id)); }
    catch { /* table not created yet */ }
    // Stored DNC verdicts hydrate each row: a FRESH clear flips the
    // dnc_consent_missing blocker; listed/refused stays blocked. (dnc_records.js)
    const dncMap = dncStore.statusMap();
    let items = rows.map((r) => {
      let signals = {}; try { signals = JSON.parse(r.signals_json || "{}"); } catch { signals = {}; }
      const phoneKey = normalizePhone(r.listing_agent_phone);
      if (phoneKey && dncMap.has(phoneKey) && r.dnc_status == null) r = { ...r, dnc_status: dncMap.get(phoneKey) };
      const why = whyNotCallNow(r, { signals });
      const { signals_json, listing_agent_phone, listing_agent_email, asking_price, contract_price, price, offer_amount, ...rest } = r;
      return applyOutreachSuppression({ ...rest, signals, why_not_call_now: why, call_now_ready: why.length === 0 }, suppressed);
    });
    if (wantReady) items = items.filter((it) => it.call_now_ready);
    if (wantDistress) items = items.filter((it) => it.signals.distress || it.signals.distress_present || it.signals.distress_signal);
    if (spreadWant) items = items.filter((it) => (it.signals.spread_status || it.signals.spread) === spreadWant);
    if (signalWant) items = items.filter((it) => it.signals[`${signalWant}_owner`]);
    const total = items.length;
    items = items.slice(0, limit);
    res.json({ counts, items, total, returned: items.length });
  } catch (e) {
    res.status(503).json({ error: "pro-queue not built yet — run the Fill Properties pipeline (or: node tools/build_pro_queue.mjs --persist)", detail: String(e.message || e) });
  }
});

// Daily call sheet — the operator's dial list. COMPLIANCE BY CONSTRUCTION:
// a phone number appears ONLY when a fresh DNC clear is on record
// (dnc_records.js); otherwise the cell is empty and dnc_status says why.
// Suppressed (do_not_call) properties never appear at all.
app.get("/api/pro-queue/call-sheet.csv", (req, res) => {
  try {
    const rows = db.prepare(`SELECT q.tier, q.priority_score, p.id AS property_id,
        p.address, p.formatted_address, p.city, p.state, p.owner_name, p.arv, p.mao, p.listing_agent_phone
      FROM pro_queue q JOIN properties p ON p.id = q.property_id
      WHERE q.tier IN ('call_now','pay_to_unlock') AND p.owner_name IS NOT NULL AND p.owner_name <> ''
        AND p.id NOT IN (SELECT property_id FROM call_outcomes WHERE outreach_suppressed = 1)
      ORDER BY q.priority_score DESC LIMIT 500`).all();
    const dncMap = dncStore.statusMap();
    const lastOutcome = new Map();
    try {
      for (const o of db.prepare("SELECT property_id, outcome, follow_up_date FROM call_outcomes WHERE id IN (SELECT MAX(id) FROM call_outcomes GROUP BY property_id)").all()) lastOutcome.set(o.property_id, o);
    } catch { /* table absent */ }
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cols = ["property_id","tier","priority","owner_name","address","city","state","arv","mao","phone","dnc_status","last_outcome","follow_up_date"];
    const lines = [cols.join(",")];
    for (const r of rows) {
      const key = normalizePhone(r.listing_agent_phone);
      const verdict = key ? dncMap.get(key) : undefined;
      const phone = verdict === "clear" ? r.listing_agent_phone : "";
      const dncStatus = !key ? "no_phone_on_file" : verdict === "clear" ? "clear" : verdict ? verdict : "unchecked — do not dial";
      const lo = lastOutcome.get(r.property_id);
      lines.push([r.property_id, r.tier, r.priority_score, r.owner_name, r.address || r.formatted_address || "", r.city || "", r.state || "",
        r.arv ?? "", r.mao ?? "", phone, dncStatus, lo?.outcome || "", lo?.follow_up_date || ""].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="call-sheet-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join("\n") + "\n");
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ---------- Fill-Properties pipeline (the one-button chain) ----------
// Free, no-spend chain: enrichment → grade → build pro-queue/tiers → export. The
// only paid action (per-property skip-trace) is NOT in this chain — it stays a
// separate human/AI-gated step. One run in flight at a time; POST returns a run_id
// immediately and the work proceeds in the background; the UI polls the run.
let pipelineRunning = false;
const pjParse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const proQueueTierCounts = () => {
  try { return Object.fromEntries(db.prepare("SELECT tier, COUNT(*) c FROM pro_queue GROUP BY tier").all().map((r) => [r.tier, r.c])); }
  catch { return {}; }
};

// Enrichment coverage — why the funnel narrows. Reads the summary the build
// stage writes (data/pro_queue_summary.json): tiers, what's missing, dials.
app.get("/api/pipeline/coverage", (req, res) => {
  try {
    const p = join(__dirname, "data", "pro_queue_summary.json");
    if (!existsSync(p)) return res.status(404).json({ error: "no pro_queue_summary.json yet — run the pipeline" });
    const s = JSON.parse(readFileSync(p, "utf8"));
    // Promotion yield: what one more enrichment buys. Computed live from
    // pro_queue.missing_json so it tracks the current build.
    let promotion_yield = null;
    try {
      const combos = {};
      for (const r of db.prepare("SELECT missing_json FROM pro_queue WHERE tier = 'research'").all()) {
        let m = []; try { m = JSON.parse(r.missing_json || "[]"); } catch { m = []; }
        combos[m.slice().sort().join("+")] = (combos[m.slice().sort().join("+")] || 0) + 1;
      }
      promotion_yield = {
        research_phone_only: combos["seller_phone"] || 0,           // skiptrace wave 2
        research_arv_and_phone: combos["arv+seller_phone"] || 0,    // one comp source away
        research_owner_arv_phone: combos["arv+owner+seller_phone"] || 0,
      };
    } catch { /* pro_queue absent */ }
    res.json({ built_at: s.built_at || null, total: s.total || null, tiers: s.tiers || {}, top_missing: s.top_missing || {}, dial_activity: s.dial_activity || null, promotion_yield });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get("/api/pipeline/stages", (req, res) => {
  res.json({
    stages: PIPELINE_STAGES.map((s) => ({ id: s.id, label: s.label, optional: s.optional, network: s.network })),
    presets: PIPELINE_PRESETS,
    running: pipelineRunning,
  });
});

app.get("/api/pipeline/runs", (req, res) => {
  const rows = db.prepare("SELECT id, created_at, finished_at, status, preset, current_stage, tier_counts_json FROM pipeline_runs ORDER BY id DESC LIMIT 20").all();
  res.json(rows.map((r) => ({ id: r.id, created_at: r.created_at, finished_at: r.finished_at, status: r.status, preset: r.preset, current_stage: r.current_stage, tier_counts: pjParse(r.tier_counts_json, {}) })));
});

app.get("/api/pipeline/runs/:id", (req, res) => {
  const r = db.prepare("SELECT * FROM pipeline_runs WHERE id = ?").get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: "run not found" });
  res.json({
    id: r.id, status: r.status, created_at: r.created_at, finished_at: r.finished_at,
    preset: r.preset, current_stage: r.current_stage, error: r.error,
    filters: pjParse(r.filters_json, {}), stages: pjParse(r.stages_json, []), tier_counts: pjParse(r.tier_counts_json, {}),
  });
});

app.post("/api/pipeline/run", (req, res) => {
  if (pipelineRunning) return res.status(409).json({ error: "a pipeline run is already in progress" });
  const body = req.body || {};
  const preset = body.preset || (Array.isArray(body.stageIds) && body.stageIds.length ? "custom" : "full");
  const stageIds = resolveStageIds({ preset: body.preset, stageIds: body.stageIds });
  if (!stageIds.length) return res.status(400).json({ error: "no stages selected" });
  const num = (v) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  const filters = { minScore: num(body.minScore), hotScore: num(body.hotScore), maxSources: num(body.maxSources), pages: num(body.pages) };
  const now = new Date().toISOString();
  const stageState = stageIds.map((id) => { const s = PIPELINE_STAGES.find((x) => x.id === id); return { id, label: s?.label || id, status: "pending", optional: !!s?.optional }; });
  const info = db.prepare("INSERT INTO pipeline_runs (created_at, status, preset, stage_ids, filters_json, stages_json) VALUES (?,?,?,?,?,?)")
    .run(now, "running", preset, JSON.stringify(stageIds), JSON.stringify(filters), JSON.stringify(stageState));
  const runId = Number(info.lastInsertRowid);
  pipelineRunning = true;

  const persist = (currentStage) => { try { db.prepare("UPDATE pipeline_runs SET stages_json = ?, current_stage = ? WHERE id = ?").run(JSON.stringify(stageState), currentStage || null, runId); } catch (e) { console.warn("[pipeline] progress write skipped:", e.message); } };

  setImmediate(async () => {
    try {
      const result = await runPipeline({ stageIds, filters, repoRoot: __dirname }, {
        onStageStart: ({ id }) => { const st = stageState.find((x) => x.id === id); if (st) st.status = "running"; persist(id); },
        onStageEnd: (r) => { const st = stageState.find((x) => x.id === r.id); if (st) { st.status = r.status; st.ms = r.ms; st.code = r.code; if (r.error) st.error = r.error; } persist(null); },
      });
      try {
        db.prepare("UPDATE pipeline_runs SET status = ?, finished_at = ?, stages_json = ?, current_stage = NULL, tier_counts_json = ?, error = ? WHERE id = ?")
          .run(result.ok ? "done" : "error", new Date().toISOString(), JSON.stringify(stageState), JSON.stringify(proQueueTierCounts()), result.abortedAt ? `aborted at stage: ${result.abortedAt}` : null, runId);
      } catch (e) { console.error("[pipeline] final write failed:", e.message); }
      // One graph: the run itself becomes a Thinga (like lead-engine runs and
      // campaigns), so agents/projections can see pipeline history in the substrate.
      try {
        thinga.put({
          id: `thinga:pipeline_run-${runId}`,
          kind: "pipeline_run",
          name: `pipeline ${preset} run ${runId} — ${result.ok ? "done" : "error"}`,
          category_path: "Pipeline/Runs",
          content: {
            run_id: runId, status: result.ok ? "done" : "error", preset, filters,
            stages: stageState.map((s) => ({ id: s.id, status: s.status, ms: s.ms ?? null })),
            tier_counts: proQueueTierCounts(), aborted_at: result.abortedAt || null,
          },
        });
      } catch (e) { console.warn("[pipeline] thinga mirror skipped:", e.message); }
    } catch (e) {
      try { db.prepare("UPDATE pipeline_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), String(e.message || e), runId); } catch { /* ignore */ }
    } finally {
      pipelineRunning = false;
    }
  });

  res.json({ run_id: runId, status: "running", stage_ids: stageIds, preset });
});

// Proof stack — one property's full evidence ledger (signal, owner, valuation,
// buyer demand, seller price, spread+buyer-acceptance, queue decision) assembled
// read-only via proof_stack.buildProofStack. NORTH_STAR_VISION.md #5.
// Build the full (internal) proof stack for a property id, or null if not found.
function proofStackForProperty(id) {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(id);
  if (!p) return null;
  const cfg = acqConfig();
  const buyers = db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all();
  const buyerCandidates = buyerCandidateRows();
  const demand = rankBuyerDemand({ property: p, crmBuyers: buyers, discoveredCandidates: buyerCandidates, limit: 5 });
  const bestSeller = bestStoredSellerPrice("property", id);
  const spread = evaluateWholesaleSpread({
    ...p,
    seller_acceptable_price: bestSeller?.price,
    seller_price_source: bestSeller?.source,
    seller_price_evidence: bestSeller,
    buyer_matches: demand.all,
  }, cfg);
  return buildProofStack(p, { spread, buyerMatches: demand.all, sellerEvidence: bestSeller, spreadOptions: cfg });
}

app.get("/api/proof-stack/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be a number" });
    const proof = proofStackForProperty(id);
    if (!proof) return res.status(404).json({ error: "property not found", id });
    res.json(proof);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Buyer-safe view — what an external investor on the marketplace may see. Redacts
// seller identity/contact, exact address, our acquisition cost/margin, and
// competing buyer names (proof_stack.buyerSafeProofStack). NORTH_STAR_VISION.md #3.
app.get("/api/proof-stack/:id/buyer", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be a number" });
    const proof = proofStackForProperty(id);
    if (!proof) return res.status(404).json({ error: "property not found", id });
    res.json(buyerSafeProofStack(proof));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// KG evidence view -- route-safe read model over wholesale_kg. This exposes the
// property -> route_pack -> candidate identity -> citation graph persisted by
// tools/persist_route_pack_kg.mjs without allowing writes or arbitrary SQL.
app.get("/api/kg/properties/:id/evidence", async (req, res) => {
  const pool = createKgPool(kgConnectionString());
  try {
    const view = await buildPropertyKgEvidenceView(pool, req.params.id, {
      routePackLimit: req.query.route_pack_limit,
      candidateLimit: req.query.candidate_limit,
      citationLimit: req.query.citation_limit,
    });
    if (view?.error) return res.status(400).json({ error: view.error });
    if (!view) return res.status(404).json({ error: "property not found in KG", id: req.params.id });
    res.json(view);
  } catch (e) {
    res.status(503).json({
      error: "KG evidence view unavailable",
      detail: String(e.message || e),
      hint: "Run: node tools/persist_route_pack_kg.mjs --report-out=data/property_route_kg_report.json",
    });
  } finally {
    await pool.end();
  }
});

// Investor marketplace -- buyer-facing deal read model. This uses buyer buy-box
// matching plus proof/economics, but deliberately redacts seller contact and keeps
// outreach behind the compliance-gated route/proof stack.
app.get("/api/investor-marketplace/deals", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 25));
    const scanLimit = Math.max(limit, Math.min(5000, Number(req.query.scan_limit) || 1000));
    const minBuyerScore = Math.max(0, Math.min(100, Number(req.query.min_buyer_score) || 45));
    const properties = db.prepare(`SELECT id, formatted_address, address, city, state, zip, county, property_type,
        source, source_id, lead_score, motivation_score, distress_score, wholesale_score,
        arv, repair_estimate, mao, spread, price, owner_name, owner_mailing, owner_source,
        latitude, longitude, updated_at
      FROM properties
      ORDER BY COALESCE(wholesale_score, lead_score, distress_score, 0) DESC, updated_at DESC
      LIMIT ?`).all(scanLimit);
    const sellerEvidenceByPropertyId = {};
    for (const p of properties) {
      const ev = bestStoredSellerPrice("property", p.id);
      if (ev) sellerEvidenceByPropertyId[p.id] = ev;
    }
    const out = buildInvestorMarketplace({
      properties,
      crmBuyers: db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all(),
      discoveredCandidates: buyerCandidateRows(),
      sellerEvidenceByPropertyId,
      spreadOptions: acqConfig(),
      limit,
      minBuyerScore,
      includeUnmatched: req.query.include_unmatched === "1",
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Buyer interest workflow -- lets a buyer request follow-up on a marketplace deal
// while preserving the redaction boundary: seller contact is never returned here.
app.post("/api/investor-marketplace/deals/:id/interest", (req, res) => {
  try {
    const propertyId = Number(req.params.id);
    if (!Number.isFinite(propertyId)) return res.status(400).json({ ok: false, error: "id must be a number" });
    const p = db.prepare(`SELECT id, formatted_address, address, city, state, zip
      FROM properties WHERE id=?`).get(propertyId);
    if (!p) return res.status(404).json({ ok: false, error: "property not found", id: propertyId });
    const built = buildBuyerInterestRequest({
      property: p,
      buyer: req.body?.buyer || req.body || {},
      message: req.body?.message,
      createdAt: now(),
    });
    if (!built.ok) return res.status(400).json(built);
    const r = built.request;
    const info = db.prepare(`INSERT INTO marketplace_interest
      (created_at, property_id, buyer_name, buyer_email, buyer_phone, buyer_buy_box, message,
       deal_title, market, proof_url, kg_evidence_url, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      r.created_at, r.property_id, r.buyer.name, r.buyer.email, r.buyer.phone, r.buyer.buy_box,
      r.message, r.deal.title, r.deal.market, r.deal.proof_url, r.deal.kg_evidence_url, r.workflow.status,
    );
    res.json({ ok: true, id: info.lastInsertRowid, request: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/investor-marketplace/interest", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const rows = db.prepare("SELECT * FROM marketplace_interest ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json(buildBuyerInterestQueue({ requests: rows, limit }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/wholesale-spread/audit", (req, res) => {
  const cfg = acqConfig();
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 1000));
  const buyers = db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all();
  const buyerCandidates = buyerCandidateRows();
  const leadRows = db.prepare(`SELECT id, 'lead' record_type, address, city, state, zip, property_type,
      asking_price, arv, repair_estimate, mao, contract_price, offer_amount, assignment_fee, source, stage,
      seller_name, seller_phone, seller_email
    FROM leads ORDER BY updated_at DESC LIMIT ?`).all(limit);
  const propRows = db.prepare(`SELECT id, 'property' record_type, formatted_address address, city, state, zip, property_type,
      price, arv, repair_estimate, mao, spread, source, status, listing_agent_name, listing_agent_phone, listing_agent_email,
      lead_score, wholesale_score
    FROM properties ORDER BY updated_at DESC LIMIT ?`).all(limit);
  const records = [...leadRows, ...propRows];
  const audited = records.map((r) => {
    const bestSeller = bestStoredSellerPrice(r.record_type, r.id);
    const demand = rankBuyerDemand({ property: r, crmBuyers: buyers, discoveredCandidates: buyerCandidates, limit: 5 });
    const buyerMatches = demand.all;
    const audit = evaluateWholesaleSpread({
      ...r,
      seller_acceptable_price: bestSeller?.price,
      seller_price_source: bestSeller?.source,
      seller_price_evidence: bestSeller,
      buyer_matches: buyerMatches,
    }, cfg);
    return {
      record_type: r.record_type,
      id: r.id,
      address: r.address,
      source: r.source,
      status: audit.status,
      projected_spread: audit.projectedSpread,
      target_fee: audit.targetFee,
      buyer_assignment_price: audit.inputs.buyerAssignmentPrice,
      seller_acceptable_price: audit.inputs.sellerAcceptablePrice,
      seller_anchor_price: audit.inputs.sellerAnchorPrice,
      acquisition_offer_price: audit.inputs.acquisitionOfferPrice,
      acquisition_offer_source: audit.inputs.acquisitionOfferSource,
      anchor_spread: audit.anchorSpread,
      negotiation: audit.negotiation,
      best_negotiation_path: audit.bestNegotiationPath,
      required_buyer_at_seller_anchor: audit.inputs.requiredBuyerAtSellerAnchor,
      max_seller_offer_for_target: audit.inputs.maxSellerOfferForTarget,
      seller_price_evidence: bestSeller,
      arv: audit.inputs.arv,
      repairs: audit.inputs.repairs,
      buyer_matches: buyerMatches,
      buyer_gaps: demand.gaps,
      buyer_discovery_paths: demand.discovery_paths.map((p) => p.id),
      reasons: audit.reasons,
      next_needed: audit.nextNeeded,
    };
  });
  const counts = summarizeSpreadAudits(audited);
  const missing = {};
  for (const a of audited) for (const n of a.next_needed || []) missing[n] = (missing[n] || 0) + 1;
  res.json({
    counts,
    missing,
    works: audited.filter((a) => a.status === "works").slice(0, 25),
    thin: audited.filter((a) => a.status === "thin").slice(0, 25),
    fails: audited.filter((a) => a.status === "fails").slice(0, 25),
    unproven: audited.filter((a) => a.status === "unproven").slice(0, 25),
  });
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
    mirrorPropertySafe(p.id); // guarded substrate mirror (refreshed scores/ARV/MAO)
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
  mirrorPropertySafe(p.id);   // property now links imported_to the lead (guarded)
  mirrorLeadSafe(leadId);     // and the new/updated lead
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
// `backups/` may be a symlink to an external drive whose target is missing (the
// D: mount isn't always present). Don't let that crash startup — degrade to
// backups-disabled instead. makeBackup() also no-ops when the dir is unwritable.
let backupDirReady = false;
try { mkdirSync(BACKUP_DIR, { recursive: true }); backupDirReady = true; }
catch (e) { console.warn(`[backup] disabled — cannot create ${BACKUP_DIR}: ${e.message}`); }
let lastBackup = null;
function makeBackup() {
  if (!backupDirReady || process.env.NO_BACKUP === "1") return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(BACKUP_DIR, `crm-${ts}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); // consistent snapshot
    const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("crm-") && f.endsWith(".db")).sort();
    while (files.length > 8) unlinkSync(join(BACKUP_DIR, files.shift())); // keep newest 8 (disk-bounded)
    lastBackup = new Date().toISOString();
    return file;
  } catch (e) { console.error("Backup failed:", e.message); return null; }
}

app.post("/api/backup", (req, res) => {
  const f = makeBackup();
  res.json(f ? { ok: true, file: f.split("/").pop(), at: lastBackup } : { error: "backup failed" });
});
app.get("/api/backup/status", (req, res) => {
  const files = backupDirReady ? readdirSync(BACKUP_DIR).filter((f) => f.startsWith("crm-") && f.endsWith(".db")).sort() : [];
  res.json({ count: files.length, last: lastBackup, latest: files[files.length - 1] || null, enabled: backupDirReady });
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

// ---- iter 9: the CRM's pure functions exposed as INVOKE-able code Thingas ----
// Handlers take (codeThinga, args, caps); args carries the target row id. All functions referenced
// here are defined above (function declarations hoisted; acqConfig/persistAnalysis in scope by now).
thinga.registerHandler("score_property", (_t, args) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(args && args.propertyId);
  if (!p) return { error: "property not found" };
  const s = scoreListing(p);
  db.prepare("UPDATE properties SET motivation_score=?, distress_score=?, lead_score=?, updated_at=? WHERE id=?")
    .run(s.motivation, s.distress, blendLead(s, p.wholesale_score), now(), p.id);
  mirrorPropertySafe(p.id);
  return s;
});
thinga.registerHandler("underwrite_lead", async (_t, args) => {
  if (!args || !args.leadId) return { error: "leadId required" };
  const r = await underwriteOne(args.leadId, acqConfig());
  mirrorLeadSafe(args.leadId);
  return r;
});
thinga.registerHandler("analyze_property", (_t, args) => {
  const p = db.prepare("SELECT * FROM properties WHERE id=?").get(args && args.propertyId);
  if (!p) return { error: "property not found" };
  const out = persistAnalysis(p, deriveAnalysis(p));
  mirrorPropertySafe(p.id);
  return out;
});
// Persist the three code Thingas that reference these handlers (idempotent on each boot).
thinga.put({ id: "thinga:code-score", kind: "code", name: "score_property", category_path: "Code", code: { handler: "score_property" } });
thinga.put({ id: "thinga:code-underwrite", kind: "code", name: "underwrite_lead", category_path: "Code", code: { handler: "underwrite_lead" } });
thinga.put({ id: "thinga:code-analyze", kind: "code", name: "analyze_property", category_path: "Code", code: { handler: "analyze_property" } });

// ---- iter 10: connector registry — every source is a connector; each is a code:connector Thinga ----
registry = buildRegistry({ rentcastGet, pullBlightTickets, detroitComps, getSetting });
for (const conn of Object.values(registry)) {
  const handlerName = `connector.${conn.id}`;
  thinga.registerHandler(handlerName, async (_t, args) => conn.search(args || {}));
  thinga.put({
    id: `thinga:connector-${conn.id}`, kind: "connector", name: conn.id,
    category_path: `Connectors/${conn.type}`, code: { handler: handlerName },
    content: { id: conn.id, region: conn.region, type: conn.type },
  });
}

// ---- route engine (real-estate domain pack): the kernel runs the real pipeline as config ----
const routeEngine = buildRealEstateEngine({ registry, batchdataKey: Boolean(batchdataKey()) });
app.get("/api/route", (req, res) => res.json({ routes: [...routeEngine.routes.keys()], plan: routeEngine.plan(req.query.goal || undefined) }));
app.post("/api/route/:id/run", async (req, res) => {
  try { const out = await routeEngine.runRoute(req.params.id, (req.body && req.body.target) || {}); res.json({ ok: true, ...out }); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// ---- source health: auto-run every connector, record ALL metrics to Postgres ----
const sourceHealth = createSourceHealth(process.env.DATABASE_URL, () => registry);
if (sourceHealth) {
  sourceHealth.init().catch((e) => console.error("source_health init failed:", e.message));
  setInterval(() => sourceHealth.probeAll().catch((e) => console.error("auto probe-all:", e.message)), 6 * 3600e3);
  setTimeout(() => sourceHealth.probeAll().catch(() => {}), 20000); // first probe shortly after boot
}
// Button-driven endpoints (no typing): run all probes, read the scoreboard, read recent runs.
app.post("/api/sources/probe", async (req, res) => {
  if (!sourceHealth) return res.status(400).json({ error: "Set DATABASE_URL (Postgres) to enable source tracking." });
  try { res.json({ ok: true, results: await sourceHealth.probeAll() }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.get("/api/sources/health", async (req, res) => {
  if (!sourceHealth) return res.json({ enabled: false, rows: [] });
  try { res.json({ enabled: true, rows: await sourceHealth.health() }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.get("/api/sources/recent", async (req, res) => {
  if (!sourceHealth) return res.json({ enabled: false, rows: [] });
  try { res.json({ enabled: true, rows: await sourceHealth.recent(Number(req.query.limit) || 50) }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ---- "Pull everything for an area": fan across every lead-producing connector, dedupe, persist ----
function areaResultToLead(r, connId) {
  return {
    address: r.formatted_address || r.address || null,
    seller_name: r.seller_name || r.listing_agent_name || null,
    seller_phone: r.listing_agent_phone || r.phone || null,
    seller_email: r.listing_agent_email || r.email || null,
    city: r.city || null, state: r.state || null, zip: r.zip || null,
    source: r.source || connId,
    motivation: r.motivation || (r.status ? "On-market" : null),
    notes: [r.price ? "List $" + Number(r.price).toLocaleString() : null,
            r.ordinance ? "Violation: " + r.ordinance : null,
            r.absentee ? "⚑ ABSENTEE" : null].filter(Boolean).join(" · ") || null,
  };
}
app.post("/api/area/pull", async (req, res) => {
  const b = req.body || {};
  const target = { city: b.city || undefined, state: b.state || undefined, zip: b.zip || undefined,
    status: "Active", days: Math.max(1, Math.min(365, Number(b.days) || 30)) };
  if (!target.city && !target.zip) return res.status(400).json({ error: "Enter a city or ZIP." });
  const t = now(); const bySource = []; let found = 0, inserted = 0, skipped = 0, withContact = 0;
  const seen = new Set(); const insertedIds = [];
  const ins = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, active, seller_name, seller_phone, seller_email, address, city, state, zip, motivation, source, notes)
      VALUES (?, ?, 'New', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const conn of Object.values(registry)) {
    if (conn.type !== "listings" && conn.type !== "violations") continue; // comps aren't leads
    let results = [], ok = true, error = null, latency = 0;
    if (sourceHealth) {
      const r = await sourceHealth.runAndRecord(conn, target); // also records metrics to the scoreboard
      results = r.results; ok = r.summary.ok; error = r.summary.error; latency = r.summary.latency_ms;
    } else {
      const s = Date.now();
      try { const out = await conn.search(target); results = Array.isArray(out) ? out : (out ? [out] : []); }
      catch (e) { ok = false; error = String(e.message || e); }
      latency = Date.now() - s;
    }
    let added = 0;
    for (const r of results) {
      const lead = areaResultToLead(r, conn.id);
      if (!lead.address) { skipped++; continue; }
      const key = canonicalAddr(lead.address); // "123 Main St" == "123 MAIN STREET" → one lead
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      if (db.prepare("SELECT id FROM leads WHERE addr_canon=?").get(key)) { skipped++; continue; } // never duplicates, across runs
      const info = ins.run(t, t, lead.seller_name, lead.seller_phone, lead.seller_email, lead.address,
        lead.city, lead.state, lead.zip, lead.motivation, lead.source, lead.notes);
      setCanon(info.lastInsertRowid, lead.address);
      mirrorLeadSafe(info.lastInsertRowid);
      insertedIds.push({ id: info.lastInsertRowid, address: lead.address, hadContact: Boolean(lead.seller_phone || lead.seller_email) });
      if (lead.seller_phone || lead.seller_email) withContact++;
      added++; inserted++;
    }
    found += results.length;
    bySource.push({ source_id: conn.id, type: conn.type, ok, found: results.length, added, latency_ms: latency, error_kind: error ? "error" : null });
  }

  // Optional skip-trace enrichment pass (BatchData) — capped to control cost; key-gated.
  let skiptraced = 0, skiptraceFound = 0, skiptraceNote = null;
  if (b.skiptrace) {
    if (!batchdataKey()) {
      skiptraceNote = "Skip-trace requested but no BatchData key — add it in Acquisitions.";
    } else {
      const limit = Math.max(1, Math.min(200, Number(b.skiptraceLimit) || 25));
      const targets = insertedIds.filter((x) => !x.hadContact).slice(0, limit);
      for (const lead of targets) {
        const st = await skipTraceOne(lead.address);
        skiptraced++;
        if (st.ok && (st.phones.length || st.emails.length)) {
          applySkipTrace(lead.id, st); mirrorLeadSafe(lead.id);
          withContact++; skiptraceFound++;
        }
        if (st.error === "bad_key") { skiptraceNote = "BatchData rejected the key."; break; }
      }
      if (!skiptraceNote) skiptraceNote = `Skip-traced ${skiptraced} (cap ${limit}); ${skiptraceFound} got contact.`;
    }
  }

  res.json({ area: `${target.city || ""} ${target.state || ""} ${target.zip || ""}`.trim(),
    found, inserted, skipped, withContact, skiptraced, skiptraceFound, skiptraceNote, bySource });
});

// ---- Autonomous lead intelligence: APIs -> faceted Thingas -> convergence -> council shortlist ----
function persistLeadEngineCycle(cycle, { councilDispatch = null } = {}) {
  const planId = cycle.search_plan?.id || "all-enabled";
  const planT = planThingaId(planId);
  const info = db.prepare(`INSERT INTO lead_engine_runs
      (created_at, target_json, raw_records, raw_thingas, converged_properties, shortlist_count,
       dispatched_council, council_packet, data_json)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(now(), JSON.stringify(cycle.target || {}), cycle.raw_records || 0, cycle.raw_thingas || 0,
      cycle.converged_properties || 0, (cycle.shortlist || []).length, councilDispatch ? 1 : 0,
      councilDispatch?.packet || null, JSON.stringify(cycle));
  const runId = info.lastInsertRowid;
  const runThingaId = `thinga:lead-engine-run-${runId}`;
  try {
    thinga.put({
      id: runThingaId,
      kind: "run",
      name: `lead-engine run ${runId}`,
      schema: "leadEngine.run.v1",
      parents: [planT],
      links: [{ kind: "ran_plan", to: planT }],
      category_path: "Runs/LeadEngine",
      content: {
        run_id: runId,
        target: cycle.target || {},
        search_plan: cycle.search_plan || {},
        raw_records: cycle.raw_records || 0,
        raw_thingas: cycle.raw_thingas || 0,
        converged_properties: cycle.converged_properties || 0,
        shortlist_count: (cycle.shortlist || []).length,
        council_packet: councilDispatch?.packet || null,
      },
    });
  } catch (e) { console.error("thinga mirror lead-engine run (non-fatal):", e.message); }
  const ins = db.prepare(`INSERT INTO lead_engine_candidates
      (run_id, created_at, thinga_id, address, score, tier, spend_allowed, status, data_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const c of cycle.shortlist || []) {
    const ci = ins.run(runId, now(), c.id || null, c.address || c.name || null, c.score || 0, c.tier || null,
      c.spend_allowed ? 1 : 0, c.spend_allowed ? "council_review" : "shortlisted", JSON.stringify(c));
    try {
      thinga.put({
        id: `thinga:lead-engine-candidate-${ci.lastInsertRowid}`,
        kind: "candidate",
        name: c.address || c.name || `candidate ${ci.lastInsertRowid}`,
        schema: "leadEngine.candidate.v1",
        parents: [runThingaId, planT],
        links: [
          { kind: "candidate_for_run", to: runThingaId },
          { kind: "candidate_from_plan", to: planT },
          ...(c.id ? [{ kind: "candidate_real_estate", to: c.id }] : []),
        ],
        category_path: `Candidates/${c.tier || "shortlisted"}`,
        content: {
          candidate_id: ci.lastInsertRowid,
          run_id: runId,
          source_thinga_id: c.id || null,
          score: c.score || 0,
          tier: c.tier || null,
          spend_allowed: Boolean(c.spend_allowed),
          parser_family: "leadEngine.shortlist.v1",
          data: c,
        },
      });
    } catch (e) { console.error("thinga mirror lead-engine candidate (non-fatal):", e.message); }
  }
  return runId;
}

async function executeLeadEngineRun(opts = {}) {
  const target = {
    city: opts.city || undefined,
    state: opts.state || undefined,
    zip: opts.zip || undefined,
    status: opts.status || "Active",
    days: Math.max(1, Math.min(365, Number(opts.days) || 30)),
  };
  if (!target.city && !target.zip) throw new Error("Enter a city or ZIP.");
  const buyers = db.prepare("SELECT * FROM buyers ORDER BY created_at DESC").all();
  const buyerCandidates = buyerCandidateRows();
  const searchPlan = searchPlanFromRequest(opts);
  const cycle = await runAutonomousLeadCycle({
    registry,
    target,
    sourceHealth,
    thingaStore: thinga,
    buyers,
    buyerCandidates,
    sourceLimit: searchPlan.maxConnectors == null ? null : Math.max(0, Math.min(100, Number(searchPlan.maxConnectors) || 0)),
    resultLimitPerSource: Math.max(1, Math.min(500, Number(opts.resultLimitPerSource) || 100)),
    shortlistLimit: Math.max(1, Math.min(100, Number(opts.shortlistLimit) || 25)),
    searchPlan,
  });
  let councilDispatch = null;
  if (opts.dispatchCouncil) {
    councilDispatch = writeAndDispatchCouncilReview({
      cycle,
      target,
      agents: Array.isArray(opts.agents) && opts.agents.length ? opts.agents : undefined,
    });
  }
  const runId = persistLeadEngineCycle(cycle, { councilDispatch });
  return { runId, cycle, councilDispatch };
}

const leadEngineConfig = () => normalizeLeadEngineSettings({
  lead_engine_auto_hours: getSetting("lead_engine_auto_hours"),
  lead_engine_city: getSetting("lead_engine_city"),
  lead_engine_state: getSetting("lead_engine_state"),
  lead_engine_zip: getSetting("lead_engine_zip"),
  lead_engine_plan_id: getSetting("lead_engine_plan_id"),
  lead_engine_source_limit: getSetting("lead_engine_source_limit"),
  lead_engine_result_limit: getSetting("lead_engine_result_limit"),
  lead_engine_shortlist_limit: getSetting("lead_engine_shortlist_limit"),
  lead_engine_dispatch_council: getSetting("lead_engine_dispatch_council"),
  last_lead_engine_run: getSetting("last_lead_engine_run"),
  last_lead_engine_run_id: getSetting("last_lead_engine_run_id"),
  last_lead_engine_error: getSetting("last_lead_engine_error"),
});

app.get("/api/lead-engine/settings", (req, res) => {
  res.json(leadEngineConfig());
});

app.post("/api/lead-engine/settings", (req, res) => {
  for (const [k, v] of Object.entries(leadEngineSettingsWrites(req.body || {}))) setSetting(k, v);
  res.json({ ok: true, ...leadEngineConfig() });
});

app.post("/api/lead-engine/run", async (req, res) => {
  const b = req.body || {};
  try {
    const { runId, cycle, councilDispatch } = await executeLeadEngineRun(b);
    res.json({ ok: true, runId, cycle, councilDispatch });
  } catch (e) {
    const msg = String(e.message || e);
    res.status(msg === "Enter a city or ZIP." ? 400 : 500).json({ error: msg });
  }
});

let leadEngineAutoRunning = false;
async function runScheduledLeadEngine() {
  if (leadEngineAutoRunning) return;
  const cfg = leadEngineConfig();
  if (!cfg.autoHours || cfg.autoHours <= 0 || (!cfg.city && !cfg.zip)) return;
  leadEngineAutoRunning = true;
  try {
    const { runId, cycle } = await executeLeadEngineRun({
      city: cfg.city,
      state: cfg.state,
      zip: cfg.zip,
      planId: cfg.planId,
      sourceLimit: cfg.sourceLimit,
      resultLimitPerSource: cfg.resultLimitPerSource,
      shortlistLimit: cfg.shortlistLimit,
      dispatchCouncil: cfg.dispatchCouncil,
    });
    setSetting("last_lead_engine_run", new Date().toISOString());
    setSetting("last_lead_engine_run_id", String(runId));
    setSetting("last_lead_engine_error", "");
    console.log(`  Lead engine auto-run #${runId}: ${(cycle.shortlist || []).length} shortlisted`);
  } catch (e) {
    const msg = String(e.message || e);
    setSetting("last_lead_engine_error", msg);
    console.error("lead-engine auto-run error:", msg);
  } finally {
    leadEngineAutoRunning = false;
  }
}
function maybeAutoLeadEngine() {
  const cfg = leadEngineConfig();
  const decision = leadEngineTickDecision(cfg);
  if (decision.action === "disabled" || decision.action === "wait") return;
  if (decision.action === "prime_clock") { setSetting("last_lead_engine_run", new Date().toISOString()); return; }
  runScheduledLeadEngine();
}
setInterval(safeTick("lead-engine", maybeAutoLeadEngine), 60 * 60 * 1000);
setTimeout(safeTick("lead-engine", maybeAutoLeadEngine), 60 * 1000);

app.get("/api/lead-engine/runs", (req, res) => {
  const rows = db.prepare(`SELECT id, created_at, target_json, raw_records, raw_thingas, converged_properties,
      shortlist_count, dispatched_council, council_packet
    FROM lead_engine_runs ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(100, Number(req.query.limit) || 20)));
  res.json({ runs: rows.map((r) => ({ ...r, target: JSON.parse(r.target_json || "{}") })) });
});

app.get("/api/lead-engine/runs/:id/candidates", (req, res) => {
  const run = db.prepare("SELECT * FROM lead_engine_runs WHERE id=?").get(req.params.id);
  if (!run) return res.status(404).json({ error: "run not found" });
  const rows = db.prepare(`SELECT id, run_id, created_at, thinga_id, address, score, tier, spend_allowed, lead_id, status, data_json
    FROM lead_engine_candidates WHERE run_id=? ORDER BY score DESC`).all(req.params.id);
  res.json({ run: { ...run, target: JSON.parse(run.target_json || "{}") }, candidates: rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })) });
});

app.get("/api/council/jobs", (req, res) => {
  res.json({ jobs: listCouncilJobs({ limit: req.query.limit }) });
});

app.get("/api/council/participants", (req, res) => {
  res.json({ participants: loadCouncilParticipants({ includeDisabled: req.query.includeDisabled === "1" }) });
});

app.get("/api/ecosystem/plans", (_req, res) => {
  res.json({ plans: listSearchPlans() });
});

app.get("/api/ecosystem/plans/:id", (req, res) => {
  const plan = getSearchPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: "search plan not found" });
  res.json({ plan });
});

app.get("/api/ecosystem/plans/:id/children", (req, res) => {
  const plan = getSearchPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: "search plan not found" });
  const pid = planThingaId(plan.id);
  const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 80));
  const ids = [...new Set(thinga.incomingLinks(pid).map((l) => l.from_id))];
  const items = ids.map((id) => thinga.get(id)).filter(Boolean)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, limit);
  const counts = {};
  for (const t of items) counts[t.kind] = (counts[t.kind] || 0) + 1;
  res.json({ plan, plan_thinga_id: pid, counts, items });
});

app.post("/api/ecosystem/plans", (req, res) => {
  try {
    const plan = saveSearchPlan(req.body || {});
    mirrorSearchPlanSafe(plan);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/ecosystem", (req, res) => {
  const searchPlan = searchPlanFromRequest({
    planId: req.query.planId,
    sourceTypes: req.query.sourceTypes ? String(req.query.sourceTypes).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    connectorIds: req.query.connectorIds ? String(req.query.connectorIds).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    maxConnectors: req.query.maxConnectors,
  });
  res.json(buildEcosystemSnapshot({
    registry,
    participants: loadCouncilParticipants({ includeDisabled: req.query.includeDisabled === "1" }),
    searchPlan,
  }));
});

app.get("/api/council/jobs/:id", (req, res) => {
  const job = readCouncilJob(req.params.id);
  if (!job) return res.status(404).json({ error: "council job not found" });
  res.json({ job });
});

app.post("/api/council/jobs/:id/sync", (req, res) => {
  try {
    res.json({ ok: true, job: syncCouncilJobResponses(req.params.id) });
  } catch (e) {
    const msg = String(e.message || e);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

app.post("/api/council/jobs/:id/retry", (req, res) => {
  try {
    res.json({ ok: true, job: retryCouncilJob(req.params.id) });
  } catch (e) {
    const msg = String(e.message || e);
    res.status(msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

app.patch("/api/lead-engine/candidates/:id", (req, res) => {
  const c = db.prepare("SELECT * FROM lead_engine_candidates WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "candidate not found" });
  const allowed = new Set(["shortlisted", "council_review", "approved_for_skiptrace", "rejected", "hold"]);
  const status = String(req.body?.status || c.status);
  if (!allowed.has(status)) return res.status(400).json({ error: "invalid status" });
  db.prepare("UPDATE lead_engine_candidates SET status=? WHERE id=?").run(status, req.params.id);
  res.json({ ok: true, status });
});

function candidateLeadPayload(candidate) {
  const data = JSON.parse(candidate.data_json || "{}");
  const prop = data.property || {};
  const owner = data.owner || {};
  const contact = data.contact || {};
  const listing = data.listing || {};
  const buyerLine = (data.buyer_matches || []).slice(0, 3)
    .map((b) => `${b.name || "buyer"} (${b.score})`).join(", ");
  const notes = [
    `Lead engine score ${data.score}; tier ${data.tier}.`,
    ...(data.reasons || []).map((r) => `Reason: ${r}`),
    buyerLine ? `Buyer demand: ${buyerLine}` : null,
    (data.spend_blocks || []).length ? `Spend blocks: ${data.spend_blocks.join("; ")}` : null,
    `Thinga: ${data.id}`,
  ].filter(Boolean).join("\n");
  return {
    seller_name: owner.owner_name || owner.seller_name || contact.contact_name || null,
    seller_phone: contact.phone || contact.seller_phone || contact.listing_agent_phone || null,
    seller_email: contact.email || contact.seller_email || contact.listing_agent_email || null,
    address: prop.address || data.address || null,
    city: prop.city || null,
    state: prop.state || null,
    zip: prop.zip || null,
    property_type: prop.property_type || null,
    asking_price: listing.price || null,
    motivation: (data.reasons || []).join("; ") || "Lead engine shortlisted",
    source: "Lead Engine",
    notes,
  };
}

function importCandidateToProspect(candidateId) {
  const c = db.prepare("SELECT * FROM lead_engine_candidates WHERE id=?").get(candidateId);
  if (!c) return { error: "candidate not found" };
  if (c.lead_id && db.prepare("SELECT id FROM leads WHERE id=?").get(c.lead_id)) return { candidate: c, leadId: c.lead_id, already: true };
  const lead = candidateLeadPayload(c);
  if (!lead.address) return { error: "candidate has no address" };
  const key = canonicalAddr(lead.address);
  const existing = db.prepare("SELECT id FROM leads WHERE addr_canon=?").get(key);
  if (existing) {
    db.prepare("UPDATE lead_engine_candidates SET lead_id=?, status=? WHERE id=?").run(existing.id, "imported_prospect", candidateId);
    return { candidate: { ...c, lead_id: existing.id }, leadId: existing.id, duplicate: true };
  }
  const t = now();
  const info = db.prepare(`INSERT INTO leads
      (created_at, updated_at, stage, active, seller_name, seller_phone, seller_email, address, city, state, zip,
       property_type, asking_price, motivation, source, notes)
      VALUES (?, ?, 'New', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t, t, lead.seller_name, lead.seller_phone, lead.seller_email, lead.address, lead.city, lead.state, lead.zip,
      lead.property_type, lead.asking_price, lead.motivation, lead.source, lead.notes);
  setCanon(info.lastInsertRowid, lead.address);
  logActivity(info.lastInsertRowid, "note", "Imported from Lead Engine candidate.\n" + lead.notes);
  mirrorLeadSafe(info.lastInsertRowid);
  db.prepare("UPDATE lead_engine_candidates SET lead_id=?, status=? WHERE id=?").run(info.lastInsertRowid, "imported_prospect", candidateId);
  return { candidate: { ...c, lead_id: info.lastInsertRowid }, leadId: info.lastInsertRowid, already: false };
}

app.post("/api/lead-engine/candidates/:id/import", (req, res) => {
  const out = importCandidateToProspect(req.params.id);
  if (out.error) return res.status(out.error === "candidate not found" ? 404 : 400).json({ error: out.error });
  res.json({ ok: true, leadId: out.leadId, already: Boolean(out.already), duplicate: Boolean(out.duplicate) });
});

app.post("/api/lead-engine/candidates/:id/skiptrace", async (req, res) => {
  let c = db.prepare("SELECT * FROM lead_engine_candidates WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "candidate not found" });
  if (c.status !== "approved_for_skiptrace" && !(req.body && req.body.force)) {
    return res.status(409).json({ error: "candidate must be approved_for_skiptrace before paid phone spend" });
  }
  if (!batchdataKey()) return res.status(400).json({ error: "Connect BatchData first (Acquisitions -> Connect skip tracing)." });
  const imported = importCandidateToProspect(req.params.id);
  if (imported.error) return res.status(400).json({ error: imported.error });
  c = db.prepare("SELECT * FROM lead_engine_candidates WHERE id=?").get(req.params.id);
  const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(imported.leadId);
  if (!lead || !lead.address) return res.status(400).json({ error: "candidate lead has no address" });
  const st = await skipTraceOne(lead.address);
  if (!st.ok) return res.status(502).json({ error: st.error === "bad_key" ? "BatchData rejected the key." : "Skip trace failed: " + st.error });
  const applied = applySkipTrace(lead.id, st);
  mirrorLeadSafe(lead.id);
  db.prepare("UPDATE lead_engine_candidates SET status=? WHERE id=?").run("skiptraced", req.params.id);
  res.json({ ok: true, leadId: lead.id, phones: st.phones.map(fmtPhone), emails: st.emails, phone: applied.phone, email: applied.email });
});

// ---- Built-in map: free OpenStreetMap pins + free Census geocoding (no keys) ----
app.get("/api/map/points", (req, res) => {
  const rows = db.prepare(`SELECT id, address, city, state, seller_name, seller_phone, stage,
      latitude, longitude, arv, mao, opportunity_score, source
    FROM leads WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND stage != 'Dead'`).all();
  res.json({ points: rows });
});
app.post("/api/map/geocode", async (req, res) => {
  const limit = Math.max(1, Math.min(300, Number(req.body && req.body.limit) || 100));
  const rows = db.prepare("SELECT id, address FROM leads WHERE latitude IS NULL AND address IS NOT NULL AND stage != 'Dead' LIMIT ?").all(limit);
  let geocoded = 0;
  for (const r of rows) {
    const g = await geocodeAddress(r.address);
    if (g.matched && g.lat && g.lon) {
      db.prepare("UPDATE leads SET latitude=?, longitude=?, updated_at=? WHERE id=?").run(g.lat, g.lon, now(), r.id);
      mirrorLeadSafe(r.id); geocoded++;
    }
  }
  const remaining = db.prepare("SELECT COUNT(*) n FROM leads WHERE latitude IS NULL AND address IS NOT NULL AND stage != 'Dead'").get().n;
  res.json({ ok: true, geocoded, remaining });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // NO_BACKUP=1 skips startup/interval snapshots — guarded boot tests must set it so they don't
  // each copy the (large) crm.db into backups/ and fill the disk (the overnight loop's drain).
  if (!process.env.NO_BACKUP) {
    makeBackup(); // snapshot on every startup
    setInterval(safeTick("backup", makeBackup), 6 * 60 * 60 * 1000); // and every 6 hours
  }
  console.log(`\n  🏠  Wholesale CRM running →  http://localhost:${PORT}\n`);
  console.log(`  Email: ${emailConfigured() ? "✅ Gmail connected (" + emailCfg().user + ")" : "⚠️  not configured — connect in the Outreach tab"}`);
  console.log(`  Backups: auto every 6h → ${BACKUP_DIR}\n`);
});

