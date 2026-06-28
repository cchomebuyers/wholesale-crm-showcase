// tools/harvest_properties.mjs - property-first wholesale harvester.
// Keeps the B2B/public-contact scraper separate. This pulls official property sources, dedupes by
// canonical address, writes data/properties_accumulating.jsonl, and can dry-run/import to properties.
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildRegistry } from "../connectors/index.js";
import { isPropertySource, mergeBatch, normalizePropertyRecord } from "./property_harvest_core.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const OUT = join(DATA_DIR, "properties_accumulating.jsonl");
const STATE = join(DATA_DIR, ".property_harvest_state.json");
const PAGE = Number(process.env.PROPERTY_HARVEST_PAGE || 200);
const DEFAULT_TARGETS = [{ city: "Detroit", state: "MI", days: 30 }];

const args = new Set(process.argv.slice(2));
const pagesPerSource = Number(process.argv.find((a) => /^--pages=/.test(a))?.split("=")[1] || process.argv[2] || 1);
const maxSources = Number(process.argv.find((a) => /^--max-sources=/.test(a))?.split("=")[1] || 0);
const maxImport = Number(process.argv.find((a) => /^--max-import=/.test(a))?.split("=")[1] || 100);
const minImportScore = Number(process.argv.find((a) => /^--min-score=/.test(a))?.split("=")[1] || 60);
const importInput = process.argv.find((a) => /^--import-in=/.test(a))?.split("=")[1] || OUT;
const doImport = args.has("--import") || args.has("--dry-run");
const dryRun = args.has("--dry-run");

mkdirSync(DATA_DIR, { recursive: true });
if (existsSync(join(repo, "docs", "HALT"))) {
  console.log("HALT present - stopping.");
  process.exit(0);
}

async function streamExistingKeys(path) {
  const keys = new Set();
  let total = 0;
  if (!existsSync(path)) return { keys, total };
  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on("line", (line) => {
      total++;
      try {
        const row = JSON.parse(line);
        if (row.addr_key) keys.add(row.addr_key);
      } catch {}
    });
    rl.on("close", res);
  });
  return { keys, total };
}

function loadState() {
  try {
    if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {}
  return { offsets: {}, exhausted: [], total: undefined, last_import: null };
}

function saveState(state) {
  writeFileSync(STATE, JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2));
}

const noop = async () => [];
const registry = buildRegistry({ rentcastGet: noop, pullBlightTickets: noop, detroitComps: noop, getSetting: () => null });
let sources = Object.values(registry).filter(isPropertySource);
if (maxSources > 0) sources = sources.slice(0, maxSources);

const state = loadState();
const exhausted = new Set(state.exhausted || []);
const { keys: existingKeys, total: existingTotal } = await streamExistingKeys(OUT);
if (typeof state.total !== "number") state.total = existingTotal;

let addedTotal = 0;
let attempted = 0;
const perSource = {};
const sample = [];

for (const conn of sources) {
  if (exhausted.has(conn.id)) continue;
  attempted++;
  let offset = state.offsets[conn.id] || 0;
  const raw = [];
  for (let p = 0; p < pagesPerSource; p++) {
    let rows = [];
    try {
      if (typeof conn.harvest === "function") {
        rows = await conn.harvest({ limit: PAGE, offset });
      } else {
        for (const target of DEFAULT_TARGETS) rows.push(...await conn.search({ ...target, limit: PAGE, offset }));
      }
    } catch (e) {
      console.error(`source ${conn.id} failed: ${String(e.message || e).slice(0, 160)}`);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      if (typeof conn.harvest === "function") exhausted.add(conn.id);
      break;
    }
    raw.push(...rows);
    offset += PAGE;
    if (typeof conn.harvest !== "function") break;
  }
  state.offsets[conn.id] = offset;

  const harvestedAt = new Date().toISOString();
  const normalized = raw.map((r) => normalizePropertyRecord(r, conn, harvestedAt)).filter(Boolean);
  const merged = mergeBatch(normalized).filter((r) => !existingKeys.has(r.addr_key));
  if (merged.length) {
    appendFileSync(OUT, merged.map((r) => JSON.stringify(r)).join("\n") + "\n");
    for (const r of merged) existingKeys.add(r.addr_key);
    perSource[conn.id] = merged.length;
    addedTotal += merged.length;
    sample.push(...merged.slice(0, Math.max(0, 5 - sample.length)));
  }
}

state.total += addedTotal;
state.exhausted = [...exhausted];

let importResult = null;
if (doImport) importResult = await importProperties({ dryRun, maxImport, minImportScore, inputPath: importInput });
saveState(state);

const live = sources.length - exhausted.size;
const breakdown = Object.entries(perSource).map(([s, n]) => `${s}+${n}`).join(", ") || "none";
console.log(`PROPERTY HARVEST: attempted ${attempted}/${sources.length} sources | +${addedTotal} new | running total = ${state.total} | ${live}/${sources.length} sources live | [${breakdown}]`);
console.log(`SAMPLE: ${JSON.stringify(sample.slice(0, 5), null, 2)}`);
if (importResult) console.log(`IMPORT: ${JSON.stringify(importResult)}`);

async function importProperties({ dryRun, maxImport, minImportScore, inputPath }) {
  if (!existsSync(inputPath)) return { dryRun, minImportScore, inputPath, inserted: 0, updated: 0, notifications: 0, reason: "import input missing" };
  const db = new DatabaseSync(join(repo, "crm.db"));
  const now = () => new Date().toISOString();
  let inserted = 0, updated = 0, notifications = 0, scanned = 0;
  const hotScore = 70;

  const insert = db.prepare(`INSERT INTO properties
    (created_at, updated_at, last_seen, addr_key, source, source_id, formatted_address, address, city, state, zip, county,
     latitude, longitude, status, price, listed_date, days_on_market, lead_score, motivation_score, distress_score, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE properties SET updated_at=?, last_seen=?, source=?, source_id=?, formatted_address=?,
    address=?, city=?, state=?, zip=?, county=?, latitude=?, longitude=?, status=?, price=?, listed_date=?,
    days_on_market=?, lead_score=?, motivation_score=?, distress_score=? WHERE addr_key=?`);
  const get = db.prepare("SELECT id FROM properties WHERE addr_key=?");
  const notifyExists = db.prepare("SELECT 1 FROM notifications WHERE property_id=?");
  const notify = db.prepare("INSERT INTO notifications (created_at, type, title, body, property_id, read) VALUES (?, ?, ?, ?, ?, 0)");

  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (scanned >= maxImport) return;
      let r; try { r = JSON.parse(line); } catch { return; }
      if (!r.addr_key || !r.address) return;
      if (Number(r.lead_score || 0) < minImportScore) return;
      scanned++;
      const t = now();
      const existing = get.get(r.addr_key);
      if (dryRun) {
        existing ? updated++ : inserted++;
        return;
      }
      if (existing) {
        update.run(t, t, r.source, r.source_id, r.formatted_address, r.address, r.city, r.state, r.zip, r.county,
          r.latitude, r.longitude, r.status, r.price, r.listed_date, r.days_on_market, r.lead_score,
          r.motivation_score, r.distress_score, r.addr_key);
        updated++;
      } else {
        const info = insert.run(t, t, t, r.addr_key, r.source, r.source_id, r.formatted_address, r.address, r.city,
          r.state, r.zip, r.county, r.latitude, r.longitude, r.status, r.price, r.listed_date, r.days_on_market,
          r.lead_score, r.motivation_score, r.distress_score, "New");
        inserted++;
        if (r.lead_score >= hotScore && !notifyExists.get(info.lastInsertRowid)) {
          notify.run(t, "hot", `New property signal - score ${r.lead_score}`, `${r.formatted_address || r.address} - ${r.distress}`, info.lastInsertRowid);
          notifications++;
        }
      }
    });
    rl.on("close", res);
  });
  db.close();
  state.last_import = { dryRun, minImportScore, inputPath, inserted, updated, notifications, scanned, at: now() };
  return state.last_import;
}
