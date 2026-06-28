// tools/poll_new_listings.mjs - lawful new-listing poller foundation.
// Uses listing connectors only (RESO/RentCast/etc.), maintains per-source cursor state, appends new
// normalized listings to data/properties_accumulating.jsonl, and can import/notify a bounded batch.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildRegistry } from "../connectors/index.js";
import { emptyCursor, normalizeNewListings, updateListingCursor } from "./listing_alert_core.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const OUT = join(DATA_DIR, "properties_accumulating.jsonl");
const CURSOR = join(DATA_DIR, ".listing_poll_state.json");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const doImport = args.has("--import");
const maxImport = Number(process.argv.find((a) => /^--max-import=/.test(a))?.split("=")[1] || 25);
const minScore = Number(process.argv.find((a) => /^--min-score=/.test(a))?.split("=")[1] || 55);

mkdirSync(DATA_DIR, { recursive: true });

function loadCursor() {
  try { if (existsSync(CURSOR)) return JSON.parse(readFileSync(CURSOR, "utf8")); } catch {}
  return emptyCursor();
}

function saveCursor(cursor) {
  writeFileSync(CURSOR, JSON.stringify({ ...cursor, updated_at: new Date().toISOString() }, null, 2));
}

function getSetting(key) {
  try {
    const db = new DatabaseSync(join(repo, "crm.db"));
    const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
    db.close();
    return r?.value || null;
  } catch {
    return null;
  }
}

async function rentcastGet(path, params) {
  const key = getSetting("rentcast_api_key") || process.env.RENTCAST_API_KEY;
  if (!key) return [];
  const url = new URL("https://api.rentcast.io/v1" + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" } });
  if (!r.ok) throw new Error(`RentCast ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return await r.json();
}

const registry = buildRegistry({ rentcastGet, pullBlightTickets: async () => [], detroitComps: async () => null, getSetting });
const listingSources = Object.values(registry).filter((c) => c.type === "listings" && typeof c.search === "function");
const target = {
  city: process.env.LISTING_CITY || "Detroit",
  state: process.env.LISTING_STATE || "MI",
  zip: process.env.LISTING_ZIP || undefined,
  status: "Active",
};

let cursor = loadCursor();
let added = 0;
const perSource = {};
const newRows = [];

for (const conn of listingSources) {
  let raw = [];
  try {
    raw = await conn.search(target);
    const normalized = normalizeNewListings(raw, conn, cursor);
    cursor = updateListingCursor(cursor, conn.id, normalized, { ok: true });
    if (normalized.length) {
      perSource[conn.id] = normalized.length;
      added += normalized.length;
      newRows.push(...normalized);
    }
  } catch (e) {
    cursor = updateListingCursor(cursor, conn.id, [], { ok: false });
    console.error(`listing source ${conn.id} failed: ${String(e.message || e).slice(0, 160)}`);
  }
}

if (!dryRun && newRows.length) appendFileSync(OUT, newRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
saveCursor(cursor);

let importResult = null;
if (doImport && !dryRun) importResult = importNewListings(newRows, { maxImport, minScore });

console.log(`LISTING POLL: sources=${listingSources.length} target=${target.city},${target.state} new=${added} dryRun=${dryRun} [${Object.entries(perSource).map(([s, n]) => `${s}+${n}`).join(", ") || "none"}]`);
if (importResult) console.log(`IMPORT: ${JSON.stringify(importResult)}`);

function importNewListings(rows, { maxImport, minScore }) {
  const db = new DatabaseSync(join(repo, "crm.db"));
  const now = () => new Date().toISOString();
  let inserted = 0, updated = 0, notifications = 0;
  const get = db.prepare("SELECT id FROM properties WHERE addr_key=?");
  const insert = db.prepare(`INSERT INTO properties
    (created_at, updated_at, last_seen, addr_key, source, source_id, formatted_address, address, city, state, zip,
     latitude, longitude, status, price, listed_date, days_on_market, listing_agent_name, listing_agent_phone,
     listing_agent_email, lead_score, motivation_score, distress_score, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE properties SET updated_at=?, last_seen=?, source=?, source_id=?, status=?, price=?,
    listed_date=?, days_on_market=?, lead_score=?, motivation_score=?, distress_score=? WHERE addr_key=?`);
  const notifyExists = db.prepare("SELECT 1 FROM notifications WHERE property_id=?");
  const notify = db.prepare("INSERT INTO notifications (created_at, type, title, body, property_id, read) VALUES (?, ?, ?, ?, ?, 0)");

  for (const r of rows.filter((x) => Number(x.lead_score || 0) >= minScore).slice(0, maxImport)) {
    const t = now();
    const existing = get.get(r.addr_key);
    if (existing) {
      update.run(t, t, r.source, r.source_id, r.status, r.price, r.listed_date, r.days_on_market,
        r.lead_score, r.motivation_score, r.distress_score, r.addr_key);
      updated++;
    } else {
      const info = insert.run(t, t, t, r.addr_key, r.source, r.source_id, r.formatted_address, r.address, r.city,
        r.state, r.zip, r.latitude, r.longitude, r.status, r.price, r.listed_date, r.days_on_market,
        r.listing_agent_name || null, r.listing_agent_phone || null, r.listing_agent_email || null,
        r.lead_score, r.motivation_score, r.distress_score, "New");
      inserted++;
      if (!notifyExists.get(info.lastInsertRowid)) {
        notify.run(t, "hot", `New on-market property - score ${r.lead_score}`, `${r.formatted_address || r.address}`, info.lastInsertRowid);
        notifications++;
      }
    }
  }
  db.close();
  return { inserted, updated, notifications, maxImport, minScore };
}
