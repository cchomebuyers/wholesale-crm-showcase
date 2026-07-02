// tools/build_pro_queue.mjs -- narrow the property database into a pro wholesaler's queue.
// Reads crm.db `properties`, classifies each into call_now / pay_to_unlock / research / hold,
// writes data/pro_queue_snapshot.jsonl + data/pro_queue_summary.json. Read-only against the DB
// by default; pass --persist to upsert decisions into a pro_queue table.
//
// Run: node tools/build_pro_queue.mjs [--limit=N] [--persist] [--min-score=60] [--hot-score=70]

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { classifyProQueue, summarizeProQueue } from "../pro_wholesaler_queue.js";
import { buyerMarketDemand } from "../buyer_discovery.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const DATA_DIR = join(repo, "data");
const SNAP = join(DATA_DIR, "pro_queue_snapshot.jsonl");
const SUM = join(DATA_DIR, "pro_queue_summary.json");

const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const limit = Number(opt("limit", 0)) || 0;
const minScore = Number(opt("min-score", 60));
const hotScore = Number(opt("hot-score", 70));
const persist = argv.includes("--persist");

if (!process.env.PIPELINE_RUN && existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 8000"); // wait on locks instead of crashing when agents write crm.db concurrently
const rows = db.prepare(
  `SELECT * FROM properties ${limit ? `LIMIT ${limit}` : ""}`
).all();

if (persist) {
  db.exec(`CREATE TABLE IF NOT EXISTS pro_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    tier TEXT NOT NULL, priority_score INTEGER,
    next_action TEXT, spend_allowed INTEGER DEFAULT 0,
    missing_json TEXT, reasons_json TEXT, signals_json TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pro_queue_tier ON pro_queue(tier, priority_score DESC)`);
}

const upsert = persist ? db.prepare(`
  INSERT INTO pro_queue (property_id, created_at, updated_at, tier, priority_score, next_action, spend_allowed, missing_json, reasons_json, signals_json)
  VALUES (?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(property_id) DO UPDATE SET
    updated_at=excluded.updated_at, tier=excluded.tier, priority_score=excluded.priority_score,
    next_action=excluded.next_action, spend_allowed=excluded.spend_allowed,
    missing_json=excluded.missing_json, reasons_json=excluded.reasons_json, signals_json=excluded.signals_json
`) : null;

// Load discovered cash buyers (+ any CRM buyers) once, so market demand can light up.
const loadBuyers = (tbl) => { try { return db.prepare(`SELECT name, areas, property_types, max_price, source_id FROM ${tbl}`).all(); } catch { return []; } };
const allBuyers = [...loadBuyers("buyer_discovery_candidates"), ...loadBuyers("buyers")];

const now = new Date().toISOString();
const decisions = [];
const lines = [];
let demandLit = 0;
for (const r of rows) {
  const demand = buyerMarketDemand(r, allBuyers);
  if (demand.has_demand) { r.buyer_matches = [demand.top_buyer]; demandLit++; }
  const d = classifyProQueue(r, { minScore, hotScore });
  decisions.push(d);
  lines.push(JSON.stringify({
    property_id: r.id, address: r.address || r.formatted_address || null,
    city: r.city, state: r.state, county: r.county, source: r.source, lead_score: r.lead_score,
    tier: d.tier, priority_score: d.priority_score, spend_allowed: d.spend_allowed,
    next_action: d.next_action, missing: d.missing, reasons: d.reasons, signals: d.signals,
  }));
  if (persist) upsert.run(r.id, now, now, d.tier, d.priority_score, d.next_action,
    d.spend_allowed ? 1 : 0, JSON.stringify(d.missing), JSON.stringify(d.reasons), JSON.stringify(d.signals));
}

writeFileSync(SNAP, lines.join("\n") + (lines.length ? "\n" : ""));
const summary = { built_at: now, db: DB, ...summarizeProQueue(decisions), thresholds: { minScore, hotScore }, persisted: persist, buyers_loaded: allBuyers.length, market_demand_lit: demandLit };

// Top call-now / pay-to-unlock examples for a quick human read.
const top = (tier) => decisions
  .map((d, i) => ({ d, r: rows[i] }))
  .filter((x) => x.d.tier === tier)
  .sort((a, b) => b.d.priority_score - a.d.priority_score)
  .slice(0, 5)
  .map((x) => ({ property_id: x.r.id, state: x.r.state, source: x.r.source, score: x.d.priority_score, next: x.d.next_action }));
summary.examples = { call_now: top("call_now"), pay_to_unlock: top("pay_to_unlock") };

writeFileSync(SUM, JSON.stringify(summary, null, 2) + "\n");

console.log(`PRO QUEUE: ${decisions.length} properties ->`,
  Object.entries(summary.tiers).map(([k, v]) => `${k}=${v}`).join(" "),
  `| spend_allowed=${summary.spend_allowed}${persist ? " | persisted" : ""}`);
console.log(`top_missing:`, summary.top_missing);
console.log(`wrote ${SNAP} + ${SUM}`);
