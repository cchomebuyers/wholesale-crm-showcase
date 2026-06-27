// tools/run_harvest_workflow.mjs — get N leads-with-phone THROUGH our system:
// buildRegistry() (the connector APIs we built) + buildHarvestEngine() (the route-engine chain).
// Run: node tools/run_harvest_workflow.mjs [N] [sourceId]
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "../connectors/index.js";
import { buildHarvestEngine } from "../packs/lead_harvest.js";

const dir = dirname(fileURLToPath(import.meta.url));
const N = Number(process.argv[2] || 1000);
const sourceId = process.argv[3] || "nyc-business-licenses";
const OUT = join(dir, "..", "data", "leads_workflow_1000.jsonl");

const noop = async () => [];
const registry = buildRegistry({ rentcastGet: noop, pullBlightTickets: noop, detroitComps: noop, getSetting: () => null });
const engine = buildHarvestEngine({ registry });

const r = await engine.runRoute("harvest_leads", { sourceId, count: N, pageSize: 1000 });
const leads = (r.result && r.result.leads) || [];
writeFileSync(OUT, leads.map((l) => JSON.stringify(l)).join("\n") + "\n");

console.log(`WORKFLOW harvest_leads (via route engine + registry)`);
console.log(`  chain: ${r.steps.map((s) => s.capability + ":" + s.status).join(" → ")}`);
console.log(`  raw=${r.vars.harvested ? r.vars.harvested.raw_count : 0} → deduped=${r.vars.deduped ? r.vars.deduped.count : 0} → gated=${leads.length}`);
const distinct = new Set(leads.map((l) => l.phone)).size;
console.log(`  ${leads.length} leads, ${distinct} distinct phones, all gated=${leads.every((l) => l.outreach_allowed === false)}`);
if (leads[0]) console.log(`  sample: ${leads[0].owner} | ${leads[0].phone} | ${leads[0].address}`);
console.log(`→ ${OUT}`);
if (leads.length < N) process.exit(2);
