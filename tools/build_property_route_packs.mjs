#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mountCrmSubstrate } from "../crm_thinga.js";
import { buildPropertyContactRoutePack, routePackToThinga } from "../packs/property_contact_route_pack.js";

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
const hasBatchData = process.env.BATCHDATA_API_KEY ? true : false;

const db = new DatabaseSync(dbPath);
const store = mountCrmSubstrate(db);

const before = counts(db);
const rows = selectPropertyThingas(db, max);

let built = 0;
let kgEntities = 0;
let kgEdges = 0;
let kgCitations = 0;
const samples = [];

for (const row of rows) {
  const thinga = rowToThinga(row);
  const pack = buildPropertyContactRoutePack(thinga, {
    hasKeys: { batchdata_api_key: hasBatchData },
  });
  const packThinga = routePackToThinga(pack);
  if (!dryRun) store.put(packThinga);
  built++;
  kgEntities += pack.kg_projection.entities.length;
  kgEdges += pack.kg_projection.edges.length;
  kgCitations += pack.kg_projection.citations.length;
  if (samples.length < 5) {
    samples.push({
      property_thinga_id: thinga.id,
      route_pack_id: packThinga.id,
      best_path: pack.contact_route_engine.best_path?.route || null,
      blocked_reason: pack.blocked_reason,
    });
  }
}

const after = dryRun ? before : counts(db);

console.log(JSON.stringify({
  db: dbPath,
  dry_run: dryRun,
  scanned_property_thingas: rows.length,
  route_packs_built: built,
  before,
  after,
  delta: {
    route_pack_thingas: after.route_pack_thingas - before.route_pack_thingas,
    route_pack_links: after.route_pack_links - before.route_pack_links,
  },
  kg_projection: {
    entities: kgEntities,
    edges: kgEdges,
    citations: kgCitations,
    persisted_to_postgres: false,
    note: "this tool stores projections inside route_pack Thingas; run tools/persist_route_pack_kg.mjs to persist them into wholesale_kg",
  },
  samples,
}, null, 2));

function selectPropertyThingas(db, max) {
  const limit = max > 0 ? " LIMIT ?" : "";
  const sql = `SELECT * FROM thingas WHERE kind='property' AND deleted_at IS NULL ORDER BY id${limit}`;
  return max > 0 ? db.prepare(sql).all(max) : db.prepare(sql).all();
}

function rowToThinga(row) {
  const axes = row.axes ? JSON.parse(row.axes) : {};
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    version: row.version,
    content: row.content ? JSON.parse(row.content) : {},
    category_path: row.category_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    ...axes,
  };
}

function counts(db) {
  const routePackThingas = db.prepare("SELECT COUNT(*) AS n FROM thingas WHERE kind='route_pack' AND deleted_at IS NULL").get().n;
  const routePackLinks = db.prepare("SELECT COUNT(*) AS n FROM thinga_links WHERE link_kind='route_pack_for'").get().n;
  const propertyThingas = db.prepare("SELECT COUNT(*) AS n FROM thingas WHERE kind='property' AND deleted_at IS NULL").get().n;
  return {
    property_thingas: propertyThingas,
    route_pack_thingas: routePackThingas,
    route_pack_links: routePackLinks,
  };
}
