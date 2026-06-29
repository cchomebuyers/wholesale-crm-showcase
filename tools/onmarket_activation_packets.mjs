import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOnMarketActivationPackets,
  renderOnMarketActivationPacketsMarkdown,
} from "../onmarket_activation_packet.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(root, "data", "source-registry");
const planJson = join(registryDir, "onmarket-activation-plan.json");
const outJson = join(registryDir, "onmarket-activation-packets.json");
const outMd = join(registryDir, "onmarket-activation-packets.md");

if (existsSync(join(root, "docs", "HALT"))) {
  console.log("HALT present - stopping.");
  process.exit(0);
}

if (!existsSync(planJson)) {
  throw new Error(`missing activation plan: ${planJson}. Run tools/onmarket_activation_report.mjs first.`);
}

const plan = JSON.parse(readFileSync(planJson, "utf8"));
const report = buildOnMarketActivationPackets(plan);

writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");
writeFileSync(outMd, renderOnMarketActivationPacketsMarkdown(report) + "\n");

console.log(`on-market activation packets: ${report.summary.total}`);
console.log(`credential_requests: ${report.summary.credential_requests}`);
console.log(`public_record_requests: ${report.summary.public_record_requests}`);
console.log(`verification_requests: ${report.summary.verification_requests}`);
console.log(`pull_checklists: ${report.summary.pull_checklists}`);
console.log(`wrote: ${outJson}`);
console.log(`wrote: ${outMd}`);
