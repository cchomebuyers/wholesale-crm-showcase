// export_ankhor_import.mjs — write the CRM's thingas as an ankhor88
// ThingaImportV2 file that ankhor's existing Smart Import accepts unchanged.
//
// Run: node tools/export_ankhor_import.mjs [--kinds=lead,property] [--limit-per-kind=200]
//      [--with-contacts] [--out=data/ankhor-export/thinga-import-v2.json]
//
// Contacts are redacted by default (ankhor88 has no DNC/consent gate);
// --with-contacts keeps them for strictly operator-side use.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildThingaImportV2 } from "../ankhor_bridge.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };

const kinds = opt("kinds", "lead,property,buyer,campaign,plan,note,task").split(",").map((s) => s.trim()).filter(Boolean);
const limitPerKind = Math.max(1, Number(opt("limit-per-kind", 200)) || 200);
const withContacts = argv.includes("--with-contacts");
const out = join(repo, opt("out", "data/ankhor-export/thinga-import-v2.json"));

const db = new DatabaseSync(join(repo, "crm.db"), { readOnly: true });
const rows = [];
for (const kind of kinds) {
  if (kind === "setting") continue; // hard exclusion, matches ankhor_bridge.js
  const r = db.prepare("SELECT id, kind, name, version, content, axes, category_path FROM thingas WHERE kind = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(kind, limitPerKind);
  rows.push(...r);
  console.log(`${kind}: ${r.length}`);
}
db.close();

const doc = buildThingaImportV2(rows, { withContacts });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`\nwrote ${out}`);
console.log(`thingas: ${doc.thingas.length} · categories: ${doc.categories.length} · contacts_redacted: ${doc.metadata.contacts_redacted}`);
console.log("import in ankhor88: Smart Import -> paste/upload this file (schema ThingaImportV2 is auto-detected).");
