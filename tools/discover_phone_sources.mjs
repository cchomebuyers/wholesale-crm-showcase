// tools/discover_phone_sources.mjs — find MORE free public datasets across America that expose
// phone + name + address, via the Socrata nationwide catalog. Verifies each live (phone populated).
// Writes connector-ready winners. Run: node tools/discover_phone_sources.mjs
const CAT = "https://api.us.socrata.com/api/catalog/v1";
const TERMS = ["business license", "active businesses", "contractor", "trade license",
  "business tax", "registered business", "vendor", "food service license", "tobacco license",
  "liquor license", "alcohol license", "food establishment", "rental registration", "short term rental",
  "salon", "tow", "dealer license", "pharmacy", "child care", "day care", "permit applicant",
  "professional license", "occupational license", "home improvement", "plumbing", "electrical license"];
const PHONE = /phone|telephone/i, NAME = /(name|owner|business|applicant|licensee|dba|contact|vendor)/i,
  ADDR = /(address|street|addr|situs|location)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function catalog(term) {
  const u = new URL(CAT);
  u.searchParams.set("q", term); u.searchParams.set("only", "dataset"); u.searchParams.set("limit", "50");
  try { const r = await fetch(u); if (!r.ok) return []; return (await r.json()).results || []; } catch { return []; }
}
async function verify(domain, id, cols) {
  const phoneCol = cols.find((c) => PHONE.test(c));
  const nameCol = cols.find((c) => NAME.test(c));
  const addrCol = cols.find((c) => ADDR.test(c));
  if (!phoneCol || !nameCol) return null;
  const u = `https://${domain}/resource/${id}.json?$where=${phoneCol}%20IS%20NOT%20NULL&$limit=2`;
  try {
    const r = await fetch(u); if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length || !rows[0][phoneCol]) return null;
    return { domain, id, phoneCol, nameCol, addrCol,
      sample: { name: rows[0][nameCol], phone: rows[0][phoneCol], addr: rows[0][addrCol] } };
  } catch { return null; }
}

const seen = new Set(); const winners = [];
for (const term of TERMS) {
  for (const res of await catalog(term)) {
    const domain = res.metadata && res.metadata.domain;
    const id = res.resource && res.resource.id;
    const cols = (res.resource && res.resource.columns_field_name) || [];
    if (!domain || !id || seen.has(domain + id)) continue;
    seen.add(domain + id);
    if (!(cols.some((c) => PHONE.test(c)) && cols.some((c) => NAME.test(c)) && cols.some((c) => ADDR.test(c)))) continue;
    const v = await verify(domain, id, cols);
    if (v) {
      winners.push({ name: res.resource.name, ...v });
      console.log(`✓ ${domain}/${id}  [${res.resource.name}]`);
      console.log(`    phone=${v.phoneCol} name=${v.nameCol} addr=${v.addrCol}  e.g. ${v.sample.name} | ${v.sample.phone}`);
    }
    await sleep(120);
    if (winners.length >= 45) break;
  }
  if (winners.length >= 45) break;
}
import { writeFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "..", "data", "source-registry", "phone-sources-found.jsonl"), winners.map((w) => JSON.stringify(w)).join("\n") + "\n");
console.log(`\nFOUND ${winners.length} verified phone+name+address datasets across America → data/source-registry/phone-sources-found.jsonl`);
