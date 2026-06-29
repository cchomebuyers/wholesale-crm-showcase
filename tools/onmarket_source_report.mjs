import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOnMarketReadiness, renderOnMarketReadinessMarkdown } from "../onmarket_source_registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(root, "data", "source-registry");
const outJson = join(registryDir, "onmarket-source-readiness.json");
const outMd = join(registryDir, "onmarket-source-readiness.md");

if (existsSync(join(root, "docs", "HALT"))) {
  console.log("HALT present - stopping.");
  process.exit(0);
}

const manifests = readdirSync(registryDir)
  .filter((name) => /^pilot-manifest-onmarket-.*\.md$/.test(name))
  .map((name) => {
    const file = join("data", "source-registry", name).replace(/\\/g, "/");
    return { file, text: readFileSync(join(registryDir, name), "utf8") };
  });

const report = buildOnMarketReadiness(manifests);
writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");
writeFileSync(outMd, renderOnMarketReadinessMarkdown(report) + "\n");

console.log(`on-market manifests: ${report.summary.total}`);
console.log(`verified: ${report.summary.verified} draft: ${report.summary.draft} blocked: ${report.summary.blocked}`);
console.log(`top source: ${report.summary.top_source || "none"}`);
console.log(`wrote: ${outJson}`);
console.log(`wrote: ${outMd}`);
