#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import {
  createKgPool,
  ensureKgSchema,
  kgConnectionString,
  kgCounts,
  kgProjectionFromRoutePackThinga,
  persistKgProjection,
  propertyRouteKgReport,
} from "../kg_projection_persistence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const dbPath = arg("db", join(root, "crm.db"));
const max = Number(arg("max", "0")) || 0;
const reportOut = arg("report-out", null);
const dryRun = process.argv.includes("--dry-run");
const connectionString = arg("kg-db", kgConnectionString());

const sqlite = new DatabaseSync(dbPath);
const routePacks = selectRoutePackThingas(sqlite, max);
const projections = routePacks
  .map(rowToThinga)
  .map(kgProjectionFromRoutePackThinga)
  .filter(Boolean);

const totals = { entities: 0, edges: 0, citations: 0 };
let before = null;
let after = null;
let report = null;

if (!dryRun) {
  const pool = createKgPool(connectionString);
  try {
    await ensureKgSchema(pool);
    before = await kgCounts(pool);
    for (const projection of projections) {
      const delta = await persistKgProjection(pool, projection, { ensureSchema: false });
      totals.entities += delta.entities;
      totals.edges += delta.edges;
      totals.citations += delta.citations;
    }
    after = await kgCounts(pool);
    report = await propertyRouteKgReport(pool, 5);
  } finally {
    await pool.end();
  }
} else {
  for (const projection of projections) {
    totals.entities += projection.entities.length;
    totals.edges += projection.edges.length;
    totals.citations += projection.citations.length;
  }
}

const output = {
  db: dbPath,
  kg_db: redactConnectionString(connectionString),
  dry_run: dryRun,
  route_pack_thingas_scanned: routePacks.length,
  projections_found: projections.length,
  projected_rows: totals,
  before,
  after,
  report,
};

if (reportOut && report) {
  writeFileSync(reportOut, JSON.stringify(report, null, 2) + "\n");
  output.report_out = reportOut;
}

console.log(JSON.stringify(output, null, 2));

function selectRoutePackThingas(db, max) {
  const limit = max > 0 ? " LIMIT ?" : "";
  const sql = `SELECT * FROM thingas WHERE kind='route_pack' AND deleted_at IS NULL ORDER BY id${limit}`;
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

function redactConnectionString(value) {
  return String(value || "").replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
}
