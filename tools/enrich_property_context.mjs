// tools/enrich_property_context.mjs - sidecar/full JSONL context fill from verified source registry.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceContext, enrichPropertyContext } from "./source_context_core.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DATA_DIR = process.env.PROPERTY_LEADS_DIR || join(repo, "data");
const REGISTRY = join(DATA_DIR, "source-registry", "county-source-registry.owner-fixed.jsonl");
const IN = process.argv.find((a) => /^--in=/.test(a))?.split("=")[1] || join(DATA_DIR, "properties_accumulating.jsonl");
const OUT = process.argv.find((a) => /^--out=/.test(a))?.split("=")[1] || join(DATA_DIR, "properties_context_enriched.jsonl");
const maxRecords = Number(process.argv.find((a) => /^--max=/.test(a))?.split("=")[1] || 0);
const dryRun = process.argv.includes("--dry-run");

function readRegistry(path) {
  const rows = [];
  if (!existsSync(path)) return rows;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

if (!existsSync(IN)) {
  console.log(`CONTEXT ENRICH: input missing ${IN}`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const context = buildSourceContext(readRegistry(REGISTRY));
let scanned = 0;
let written = 0;
let filledState = 0;
let filledCounty = 0;
let registryMatches = 0;
const samples = [];
const lines = [];

await new Promise((res) => {
  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (maxRecords > 0 && scanned >= maxRecords) return;
    let row;
    try { row = JSON.parse(line); } catch { return; }
    scanned++;
    const enriched = enrichPropertyContext(row, context);
    if (enriched.context_enrichment.filled_state) filledState++;
    if (enriched.context_enrichment.filled_county) filledCounty++;
    if (enriched.context_enrichment.source_registry_match) registryMatches++;
    if (samples.length < 5) samples.push(enriched);
    lines.push(JSON.stringify(enriched));
    written++;
  });
  rl.on("close", res);
});

if (!dryRun) writeFileSync(OUT, lines.join("\n") + (lines.length ? "\n" : ""));
console.log(`CONTEXT ENRICH: scanned=${scanned} written=${written} registry_matches=${registryMatches} filled_state=${filledState} filled_county=${filledCounty} dryRun=${dryRun}`);
console.log(`SAMPLE: ${JSON.stringify(samples, null, 2)}`);
