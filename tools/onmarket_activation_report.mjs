import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOnMarketActivationPlan, renderOnMarketActivationMarkdown } from "../onmarket_activation_plan.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(root, "data", "source-registry");
const readinessJson = join(registryDir, "onmarket-source-readiness.json");
const outJson = join(registryDir, "onmarket-activation-plan.json");
const outMd = join(registryDir, "onmarket-activation-plan.md");

if (existsSync(join(root, "docs", "HALT"))) {
  console.log("HALT present - stopping.");
  process.exit(0);
}

if (!existsSync(readinessJson)) {
  throw new Error(`missing readiness report: ${readinessJson}. Run tools/onmarket_source_report.mjs first.`);
}

const readiness = JSON.parse(readFileSync(readinessJson, "utf8"));
const plan = buildOnMarketActivationPlan(readiness);

writeFileSync(outJson, JSON.stringify(plan, null, 2) + "\n");
writeFileSync(outMd, renderOnMarketActivationMarkdown(plan) + "\n");

console.log(`on-market activation sources: ${plan.summary.total}`);
console.log(`ready_to_pull: ${plan.summary.ready_to_pull}`);
console.log(`credentials_blocked: ${plan.summary.credentials_blocked}`);
console.log(`public_records_blocked: ${plan.summary.public_records_blocked}`);
console.log(`verification_blocked: ${plan.summary.verification_blocked}`);
console.log(`wrote: ${outJson}`);
console.log(`wrote: ${outMd}`);
