// tools/property_status_report.mjs - read-only snapshot for the property intelligence loop.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const OUT = process.argv.find((a) => /^--out=/.test(a))?.split("=")[1] || join(DATA_DIR, "source-registry", "property-intelligence-status.md");
const propertyFile = join(DATA_DIR, "properties_accumulating.jsonl");
const contextFile = join(DATA_DIR, "properties_context_enriched.jsonl");
const photoFile = join(DATA_DIR, "property_photo_candidates.jsonl");
const geoFile = join(DATA_DIR, "property_geo_enrichment.v2.jsonl");
const qualityFile = join(DATA_DIR, "source-registry", "property-data-quality-queue.jsonl");

mkdirSync(dirnameSafe(OUT), { recursive: true });

function dirnameSafe(path) {
  return path.includes("\\") ? path.slice(0, path.lastIndexOf("\\")) : dirname(path);
}

function mb(path) {
  if (!existsSync(path)) return "0.0";
  return (statSync(path).size / 1024 / 1024).toFixed(1);
}

async function jsonlStats(path, each = () => {}) {
  const stats = { lines: 0, bad: 0 };
  if (!existsSync(path)) return stats;
  await new Promise((res) => {
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      stats.lines++;
      try { each(JSON.parse(line), stats); } catch { stats.bad++; }
    });
    rl.on("close", res);
  });
  return stats;
}

function dbCounts() {
  const dbPath = join(repo, "crm.db");
  if (!existsSync(dbPath)) return {};
  const db = new DatabaseSync(dbPath);
  const one = (sql) => {
    try { return db.prepare(sql).get().n; } catch { return null; }
  };
  const counts = {
    properties: one("SELECT COUNT(*) n FROM properties"),
    hot_notifications: one("SELECT COUNT(*) n FROM notifications WHERE type='hot'"),
    unread_notifications: one("SELECT COUNT(*) n FROM notifications WHERE read=0"),
    imported_leads: one("SELECT COUNT(*) n FROM properties WHERE imported_lead_id IS NOT NULL"),
    properties_with_state: one("SELECT COUNT(*) n FROM properties WHERE state IS NOT NULL AND state != ''"),
    properties_with_county: one("SELECT COUNT(*) n FROM properties WHERE county IS NOT NULL AND county != ''"),
    properties_with_city: one("SELECT COUNT(*) n FROM properties WHERE city IS NOT NULL AND city != ''"),
    properties_with_zip: one("SELECT COUNT(*) n FROM properties WHERE zip IS NOT NULL AND zip != ''"),
    properties_with_coords: one("SELECT COUNT(*) n FROM properties WHERE latitude IS NOT NULL AND longitude IS NOT NULL"),
    properties_with_owner: one("SELECT COUNT(*) n FROM properties WHERE owner_name IS NOT NULL AND owner_name != ''"),
  };
  db.close();
  return counts;
}

function diskRows() {
  try {
    const out = execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-PSDrive -Name C,D | Select-Object Name,Free,Used | ConvertTo-Json -Compress",
    ], { encoding: "utf8" });
    const rows = JSON.parse(out);
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      name: r.Name,
      free_gb: (Number(r.Free || 0) / 1024 / 1024 / 1024).toFixed(2),
      used_gb: (Number(r.Used || 0) / 1024 / 1024 / 1024).toFixed(2),
    }));
  } catch {
    return [];
  }
}

const sourceCounts = {};
const distressCounts = {};
let missingOwner = 0;
let missingCity = 0;
let missingState = 0;
let missingZip = 0;
let complianceBad = 0;
const propertyStats = await jsonlStats(propertyFile, (r) => {
  sourceCounts[r.source || "unknown"] = (sourceCounts[r.source || "unknown"] || 0) + 1;
  distressCounts[r.distress || "unknown"] = (distressCounts[r.distress || "unknown"] || 0) + 1;
  if (!r.owner_name) missingOwner++;
  if (!r.city) missingCity++;
  if (!r.state) missingState++;
  if (!r.zip) missingZip++;
  if (r.outreach_allowed !== false || r.compliance_status !== "unchecked") complianceBad++;
});

let contextRegistryMatches = 0;
let contextFilledState = 0;
let contextFilledCounty = 0;
let contextMissingOwner = 0;
let contextMissingCity = 0;
let contextMissingState = 0;
let contextMissingZip = 0;
const contextStats = await jsonlStats(contextFile, (r) => {
  if (r.context_enrichment?.source_registry_match) contextRegistryMatches++;
  if (r.context_enrichment?.filled_state) contextFilledState++;
  if (r.context_enrichment?.filled_county) contextFilledCounty++;
  if (!r.owner_name) contextMissingOwner++;
  if (!r.city) contextMissingCity++;
  if (!r.state) contextMissingState++;
  if (!r.zip) contextMissingZip++;
});

let photoWithCandidate = 0;
const photoStats = await jsonlStats(photoFile, (r) => {
  if (r.has_photo_candidate) photoWithCandidate++;
});
let geoMatched = 0;
let geoExpectedCityMatch = 0;
let geoExpectedCityMismatch = 0;
const geoStats = await jsonlStats(geoFile, (r) => {
  if (r.matched) geoMatched++;
  if (r.expected_city_match === true) geoExpectedCityMatch++;
  if (r.expected_city_match === false && r.matched) geoExpectedCityMismatch++;
});
const qualityStats = await jsonlStats(qualityFile);
const counts = dbCounts();
const disks = diskRows();
const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
const topDistress = Object.entries(distressCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
const generated = new Date().toISOString();

const lines = [
  "# Property Intelligence Status",
  "",
  `Generated: ${generated}`,
  "",
  "## Files",
  "",
  `- properties JSONL: ${propertyStats.lines} rows (${mb(propertyFile)} MB), bad JSON lines: ${propertyStats.bad}`,
  `- context-enriched JSONL: ${contextStats.lines} rows (${mb(contextFile)} MB), registry matches: ${contextRegistryMatches}, filled state: ${contextFilledState}, filled county: ${contextFilledCounty}`,
  `- photo candidates JSONL: ${photoStats.lines} rows (${mb(photoFile)} MB), with candidate: ${photoWithCandidate}, gaps: ${photoStats.lines - photoWithCandidate}`,
  `- Census geo-enrichment JSONL v2: ${geoStats.lines} rows (${mb(geoFile)} MB), matched: ${geoMatched}, expected-city matches: ${geoExpectedCityMatch}, matched wrong-city flags: ${geoExpectedCityMismatch}`,
  `- property quality queue: ${qualityStats.lines} rows (${mb(qualityFile)} MB)`,
  "",
  "## CRM",
  "",
  `- properties table: ${counts.properties ?? "unknown"}`,
  `- properties with state: ${counts.properties_with_state ?? "unknown"}`,
  `- properties with county: ${counts.properties_with_county ?? "unknown"}`,
  `- properties with city: ${counts.properties_with_city ?? "unknown"}`,
  `- properties with zip: ${counts.properties_with_zip ?? "unknown"}`,
  `- properties with coordinates: ${counts.properties_with_coords ?? "unknown"}`,
  `- properties with owner: ${counts.properties_with_owner ?? "unknown"}`,
  `- hot notifications: ${counts.hot_notifications ?? "unknown"}`,
  `- unread notifications: ${counts.unread_notifications ?? "unknown"}`,
  `- properties imported to leads: ${counts.imported_leads ?? "unknown"}`,
  "",
  "## Missing Data",
  "",
  "Raw harvest file:",
  "",
  `- missing owner: ${missingOwner}`,
  `- missing city: ${missingCity}`,
  `- missing state: ${missingState}`,
  `- missing zip: ${missingZip}`,
  `- compliance violations detected: ${complianceBad}`,
  "",
  "Context-enriched sidecar:",
  "",
  `- missing owner: ${contextMissingOwner}`,
  `- missing city: ${contextMissingCity}`,
  `- missing state: ${contextMissingState}`,
  `- missing zip: ${contextMissingZip}`,
  "",
  "## Top Sources",
  "",
  ...topSources.map(([source, n]) => `- ${source}: ${n}`),
  "",
  "## Distress Signals",
  "",
  ...topDistress.map(([distress, n]) => `- ${distress}: ${n}`),
  "",
  "## Disk",
  "",
  ...(disks.length ? disks.map((d) => `- ${d.name}: ${d.free_gb} GB free, ${d.used_gb} GB used`) : ["- unavailable"]),
  "",
  "## Current Blockers",
  "",
  "- RentCast listing poll returned 401 auth/api-key-invalid in the prior dry run.",
  "- RESO connector is scaffolded but lacks feed URL/token configuration.",
  "- Current official property rows have no embedded photo URLs; photo sidecar is gap-only until lawful media sources or a Street View key are configured.",
  "- Owner/contact enrichment remains gated; no contacts are outreach allowed.",
  "",
];

writeFileSync(OUT, lines.join("\n"));
console.log(`PROPERTY STATUS: wrote ${OUT}`);
console.log(lines.slice(0, 28).join("\n"));
