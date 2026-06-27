// tools/autoconfig_phone_sources.mjs — scale source discovery to HUNDREDS. Queries the Socrata
// nationwide catalog (many terms, paginated), and for each dataset that has a phone column, probes a
// real row and auto-picks name/address/phone/city/zip columns by priority + populated-check. Emits
// ready connector configs to connectors/phone-sources.add.auto.json (skips already-configured ones).
// Run: node tools/autoconfig_phone_sources.mjs
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const CAT = "https://api.us.socrata.com/api/catalog/v1";
const TERMS = ["business license", "active businesses", "contractor", "trade license", "business tax",
  "registered business", "vendor", "food service", "liquor license", "alcohol license", "food establishment",
  "rental registration", "short term rental", "salon", "tow operator", "dealer license", "pharmacy",
  "child care", "home improvement", "plumbing", "electrical license", "occupational license",
  "professional license", "permit", "license"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAME_PRI = [/owner.?name|^owner$|business_owner/i, /business_?name|company_?name|legal_name|trade_name|account_name|facility_name|agency_name|establishment_name|licensee|contractor_name|applicant|org_?name/i, /\bname\b/i];
const ADDR_PRI = [/street_address|mailing_address|business_address|company_address|work_?address/i, /address1|addr1/i, /\baddress\b|street/i];
const PHONE_PRI = [/contact_phone|business_phone|primary_phone|establishment_phone|phone_number|work_?phone|telephone/i, /phone/i];
const CITY = /^city$|_city$/i, ZIP = /zip|postal/i;
const STATE_BY_DOMAIN = { "data.ny.gov": "NY", "data.cityofnewyork.us": "NY", "data.wa.gov": "WA",
  "cos-data.seattle.gov": "WA", "data.ct.gov": "CT", "data.nj.gov": "NJ", "data.vermont.gov": "VT",
  "data.delaware.gov": "DE", "data.mo.gov": "MO", "data.nola.gov": "LA", "opendata.utah.gov": "UT",
  "data.montgomerycountymd.gov": "MD", "data.texas.gov": "TX", "data.virginia.gov": "VA",
  "data.oregon.gov": "OR", "data.colorado.gov": "CO", "performance.cityofhenderson.com": "NV" };

const pick = (cols, pris) => { for (const re of pris) { const c = cols.find((x) => re.test(x)); if (c) return c; } return null; };
const looksName = (v) => typeof v === "string" && v.trim().length > 1 && !/^\d/.test(v) && !/^\d{4}-\d\d-\d\d/.test(v) && !v.includes("T00:00");

async function catalog(term, offset) {
  const u = new URL(CAT);
  u.searchParams.set("q", term); u.searchParams.set("only", "dataset");
  u.searchParams.set("limit", "100"); u.searchParams.set("offset", String(offset));
  try { const r = await fetch(u); if (!r.ok) return []; return (await r.json()).results || []; } catch { return []; }
}

// already-configured datasetIds
const have = new Set();
for (const f of readdirSync(join(dir, "..", "connectors"))) {
  if (/^phone-sources(\.add\..*)?\.(data\.)?json$/.test(f) || /^phone-sources\.data\.json$/.test(f) || /^phone-sources\.add\..*\.json$/.test(f)) {
    try { for (const c of JSON.parse(readFileSync(join(dir, "..", "connectors", f), "utf8"))) have.add(c.datasetId); } catch {}
  }
}
have.add("w7w3-xahh"); // NYC built-in

const seen = new Set(); const configs = []; const TARGET = 40;
outer:
for (const term of TERMS) {
  for (let off = 0; off < 200; off += 100) {
    const results = await catalog(term, off);
    if (!results.length) break;
    for (const res of results) {
      const domain = res.metadata && res.metadata.domain;
      const id = res.resource && res.resource.id;
      const cols = (res.resource && res.resource.columns_field_name) || [];
      if (!domain || !id || seen.has(id) || have.has(id)) continue;
      seen.add(id);
      const phoneCol = pick(cols, PHONE_PRI), nameCol = pick(cols, NAME_PRI), addrCol = pick(cols, ADDR_PRI);
      if (!phoneCol || !nameCol || !addrCol) continue;
      // probe a real row to confirm phone populated + name looks like a name
      try {
        const r = await fetch(`https://${domain}/resource/${id}.json?$where=${phoneCol}%20IS%20NOT%20NULL&$limit=2`);
        if (!r.ok) continue;
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) continue;
        const s = rows[0];
        if (!s[phoneCol] || !looksName(s[nameCol])) continue;
        const cityCol = cols.find((c) => CITY.test(c)) || null;
        const zipCol = cols.find((c) => ZIP.test(c)) || null;
        const cfg = { id: `${domain.split(".")[0]}-${id}`.slice(0, 48), domain, datasetId: id,
          phoneCol, nameCol, addrCol, cityCol: cityCol || undefined, zipCol: zipCol || undefined,
          region: domain, state: STATE_BY_DOMAIN[domain] || undefined };
        configs.push(cfg);
        console.log(`+ ${domain}/${id}  name=${nameCol} phone=${phoneCol} addr=${addrCol}  e.g. ${s[nameCol]} | ${s[phoneCol]}`);
        if (configs.length >= TARGET) break outer;
      } catch {}
      await sleep(90);
    }
  }
}

writeFileSync(join(dir, "..", "connectors", "phone-sources.add.auto.json"), JSON.stringify(configs, null, 2) + "\n");
console.log(`\nAUTO-CONFIGURED ${configs.length} new phone sources → connectors/phone-sources.add.auto.json`);
