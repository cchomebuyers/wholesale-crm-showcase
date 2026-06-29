#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mountCrmSubstrate, mirrorProperty } from "../crm_thinga.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const dbPath = arg("db", join(root, "crm.db"));
const max = Number(arg("max", "0")) || 0;
const dryRun = process.argv.includes("--dry-run");

const db = new DatabaseSync(dbPath);
const store = mountCrmSubstrate(db);

const before = substrateCounts(db);
const limitSql = max > 0 ? " LIMIT ?" : "";
const stmt = db.prepare(`SELECT * FROM properties ORDER BY id${limitSql}`);
const rows = max > 0 ? stmt.all(max) : stmt.all();

let mirrored = 0;
const samples = [];
for (const row of rows) {
  if (!dryRun) mirrorProperty(store, row);
  mirrored++;
  if (samples.length < 5) samples.push({ id: row.id, address: row.formatted_address || row.address || null });
}

const after = dryRun ? before : substrateCounts(db);

console.log(JSON.stringify({
  db: dbPath,
  dry_run: dryRun,
  scanned: rows.length,
  mirrored,
  before,
  after,
  delta: {
    property_thingas: after.property_thingas - before.property_thingas,
    with_facts: after.with_facts - before.with_facts,
    with_field_edges: after.with_field_edges - before.with_field_edges,
    with_proof_citations: after.with_proof_citations - before.with_proof_citations,
  },
  samples,
}, null, 2));

function substrateCounts(db) {
  const rows = db.prepare("SELECT content FROM thingas WHERE kind='property' AND deleted_at IS NULL").all();
  const counts = {
    property_thingas: rows.length,
    with_facts: 0,
    with_field_edges: 0,
    with_proof_citations: 0,
  };
  for (const row of rows) {
    let content;
    try { content = JSON.parse(row.content || "{}"); } catch { continue; }
    const substrate = content.substrate || {};
    if (substrate.facts?.identity) counts.with_facts++;
    if (Array.isArray(substrate.field_edges)) counts.with_field_edges++;
    if (Array.isArray(substrate.proof_stack?.citations) && substrate.proof_stack.citations.length) {
      counts.with_proof_citations++;
    }
  }
  return counts;
}
