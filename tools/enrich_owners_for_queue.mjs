// tools/enrich_owners_for_queue.mjs — owner-join for the pro queue.
// For pay_to_unlock (default) properties whose state has a verified owner source,
// look up the owner of record (public record) and write owner_name/owner_mailing/apn
// to crm.db. Owner name is NOT a contact — outreach stays compliance-gated elsewhere.
//
// Run: node tools/enrich_owners_for_queue.mjs [--tier=pay_to_unlock] [--max=N] [--dry-run]

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildOwnerSources } from "../connectors/owner_source.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const tier = opt("tier", "pay_to_unlock");
const max = Number(opt("max", 0)) || 0;
const dryRun = argv.includes("--dry-run");

if (existsSync(join(repo, "docs", "HALT"))) { console.log("HALT present - stopping."); process.exit(0); }

const cfgPath = join(repo, "data", "owner-sources.data.json");
const configs = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : [];
const sources = buildOwnerSources(configs);
const byState = new Map();
for (const s of sources) if (s.state) byState.set(s.state.toUpperCase(), s);
console.log(`owner sources: ${sources.length} [${[...byState.keys()].join(", ") || "none"}]`);

const stateFilter = (opt("state", "") || "").toUpperCase();
const db = new DatabaseSync(DB);
// tier=all -> every property (no pro_queue join); otherwise scope to one queue tier.
const where = ["(p.owner_name IS NULL OR p.owner_name = '')"];
const params = [];
if (stateFilter) { where.push("upper(p.state) = ?"); params.push(stateFilter); }
let sql;
if (tier === "all") {
  sql = `SELECT p.id, p.address, p.formatted_address, p.state, p.owner_name FROM properties p
         WHERE ${where.join(" AND ")} ${max ? `LIMIT ${max}` : ""}`;
} else {
  where.unshift("q.tier = ?"); params.unshift(tier);
  sql = `SELECT p.id, p.address, p.formatted_address, p.state, p.owner_name
         FROM properties p JOIN pro_queue q ON q.property_id = p.id
         WHERE ${where.join(" AND ")} ${max ? `LIMIT ${max}` : ""}`;
}
const rows = db.prepare(sql).all(...params);

const upd = db.prepare(`UPDATE properties SET owner_name=?, owner_mailing=COALESCE(?, owner_mailing),
  owner_source=?, owner_enriched_at=?, updated_at=? WHERE id=?`);

const now = new Date().toISOString();
let attempted = 0, matched = 0, skippedNoSource = 0;
const bySource = {};
const samples = [];

for (const r of rows) {
  const src = byState.get(String(r.state || "").toUpperCase());
  if (!src) { skippedNoSource++; continue; }
  attempted++;
  const situs = r.address || r.formatted_address;
  const hit = await src.lookup(situs);
  if (!hit) continue;
  matched++;
  bySource[hit.owner_source] = (bySource[hit.owner_source] || 0) + 1;
  if (samples.length < 5) samples.push({ id: r.id, situs, owner: hit.owner_name });
  if (!dryRun) upd.run(hit.owner_name, hit.owner_mailing, hit.owner_source, now, now, r.id);
}

const withOwner = db.prepare(`SELECT COUNT(*) c FROM properties WHERE owner_name IS NOT NULL AND owner_name<>''`).get().c;
console.log(`OWNER-JOIN tier=${tier}${dryRun ? " [DRY]" : ""}: candidates=${rows.length} attempted=${attempted} matched=${matched} no_source=${skippedNoSource}`);
console.log(`by_source: ${JSON.stringify(bySource)} | total properties with owner now: ${withOwner}`);
if (samples.length) console.log(`samples: ${JSON.stringify(samples)}`);
