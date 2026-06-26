// tools/prove_rulesreg.mjs — prove the Thinga substrate on real data.
//
// A folder tree is already a Thinga containment graph: a directory is a `folder` Thinga whose
// `children` are its entries; a file is a `file` Thinga whose content is its bytes (base64, so the
// round-trip is byte-exact regardless of encoding/line-endings). We import a tree into the runtime,
// export it back to disk, and assert the two trees are byte-identical. No live app is touched —
// this is the safest possible proof that PUT/GET preserve structure and content (04-EXECUTION Step 1).
//
// Run directly:   node tools/prove_rulesreg.mjs [targetDir]    (default: ../rulesreg/_scraping)
// Or import proveRoundtrip() from a test.

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createThingaStore } from "../thinga.js";

// Walk a directory into the store, returning the root Thinga id. `relPath` becomes category_path.
export function folderToThingas(store, dir, relPath = basename(dir)) {
  const entries = readdirSync(dir).sort(); // stable order so the graph is deterministic
  const childIds = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relPath + "/" + entry;
    if (statSync(full).isDirectory()) {
      childIds.push(folderToThingas(store, full, rel));
    } else {
      const bytes = readFileSync(full); // Buffer
      childIds.push(store.put({
        kind: "file", name: entry, category_path: rel,
        content: { encoding: "base64", bytes: bytes.toString("base64") },
      }));
    }
  }
  return store.put({ kind: "folder", name: basename(dir), category_path: relPath, children: childIds });
}

// Export a folder Thinga (and descendants) back to disk under outDir.
export function thingasToFolder(store, rootId, outDir) {
  const root = store.get(rootId, 0);
  const here = join(outDir, root.name);
  mkdirSync(here, { recursive: true });
  for (const childId of root.children) {
    const child = store.get(childId, 0);
    if (child.kind === "folder") {
      thingasToFolder(store, childId, here);
    } else {
      writeFileSync(join(here, child.name), Buffer.from(child.content.bytes, "base64"));
    }
  }
  return here;
}

// Compare two directory trees byte-for-byte. Returns { ok, files, diffs[] }.
export function diffTrees(a, b) {
  const diffs = [];
  let files = 0;
  function walk(da, db) {
    const ea = readdirSync(da).sort();
    const eb = readdirSync(db).sort();
    if (ea.join("|") !== eb.join("|")) diffs.push(`entry mismatch in ${da}: [${ea}] vs [${eb}]`);
    for (const name of ea) {
      const pa = join(da, name), pb = join(db, name);
      if (!existsSync(pb)) { diffs.push(`missing in export: ${pb}`); continue; }
      if (statSync(pa).isDirectory()) { walk(pa, pb); }
      else {
        files++;
        if (!readFileSync(pa).equals(readFileSync(pb))) diffs.push(`byte mismatch: ${name}`);
      }
    }
  }
  walk(a, b);
  return { ok: diffs.length === 0, files, diffs };
}

// Full proof: import dir → store → export → diff. Returns the diff result.
export function proveRoundtrip(dir) {
  const store = createThingaStore(":memory:");
  const rootId = folderToThingas(store, dir);
  const outBase = join(tmpdir(), `thinga-roundtrip-${randomUUID()}`);
  mkdirSync(outBase, { recursive: true });
  try {
    thingasToFolder(store, rootId, outBase);
    const exported = join(outBase, basename(dir));
    const result = diffTrees(dir, exported);
    result.thingaCount = store.query(null).length;
    return result;
  } finally {
    rmSync(outBase, { recursive: true, force: true });
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("prove_rulesreg.mjs")) {
  const target = process.argv[2] || join(import.meta.dirname, "..", "..", "rulesreg", "_scraping");
  if (!existsSync(target)) { console.error(`target not found: ${target}`); process.exit(2); }
  const r = proveRoundtrip(target);
  console.log(`\n  rulesreg round-trip: ${r.ok ? "✅ BYTE-IDENTICAL" : "❌ DIFFERENCES"}`);
  console.log(`  ${r.files} files · ${r.thingaCount} Thingas · target: ${target}`);
  if (!r.ok) { for (const d of r.diffs.slice(0, 20)) console.log("   - " + d); process.exit(1); }
  console.log();
}
