// thinga.js — the ankhor.v1 runtime.
//
// One recursive type (the Thinga, six axes), three operations (PUT / GET / INVOKE),
// over node:sqlite. Code Thingas resolve to REGISTERED native handlers by name — never eval
// (the 5DEngine handlers.js pattern). Every PUT bumps version, recomputes a sha256 checksum,
// and signs it with the store's ed25519 key. Deletes are tombstones; history is the truth.
//
// Canonical spec: yearTwo777/synthesis/ANKHOR_ARCHITECTURE.md  (six axes, §6 operations, §7 soft constraints)
// Migration map:  dev/plans/6-26-26/01-SUBSTRATE.md
//
// Usage:
//   import { createThingaStore } from "./thinga.js";
//   const store = createThingaStore("crm.db");       // or ":memory:", or an existing DatabaseSync
//   store.registerHandler("score", (t, args, caps) => ...);
//   const id = store.put({ kind: "lead", name: "16133 STEEL", content: { stage: "New" } });
//   const lead = store.get(id, 1);                    // depth=1 inlines children
//   store.invoke(codeId, { leadId: id });

import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";

export const ANKHOR_VERSION = "ankhor.v1";

// The six axes. `content` (axis 2) is a top-level column; everything in AXIS_FIELDS is folded
// into the `axes` JSON column. id/kind/name/version (axis 1) + timestamps are columns too.
const AXIS_FIELDS = [
  // axis 3 — classification
  "tags", "schema", "color", "icon",
  // axis 4 — relationships (the recursion lives here)
  "children", "parents", "links", "subworld",
  // axis 5 — time
  "due_date", "due_time", "recurrence", "ttl_seconds",
  // axis 6 — execution + trust
  "code", "interaction_script", "physics_profile", "permissions", "owner", "origin",
  "signature", "checksum",
];

const nowISO = () => new Date().toISOString();

// Deterministic stringify (sorted keys) so the checksum is stable across runs.
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

// Fill every axis so no Thinga is ever missing one (Ankhor §2: "none can be omitted; some empty").
function normalize(input) {
  const t = { ...input };
  t.id = t.id || `thinga:${randomUUID()}`;
  if (!t.kind) throw new Error("Thinga requires a `kind`");
  t.name = t.name ?? null;
  t.version = Number.isInteger(t.version) ? t.version : 0; // bumped to >=1 on PUT
  t.content = t.content ?? {};
  t.tags = t.tags || [];
  t.schema = t.schema ?? null;
  t.color = t.color ?? null;
  t.icon = t.icon ?? null;
  t.children = t.children || []; // array of thinga ids
  t.parents = t.parents || [];   // array of thinga ids
  t.links = t.links || [];       // [{ kind, to }]
  t.subworld = t.subworld ?? null;
  t.category_path = t.category_path ?? null;
  t.due_date = t.due_date ?? null;
  t.due_time = t.due_time ?? null;
  t.recurrence = t.recurrence ?? null;
  t.ttl_seconds = t.ttl_seconds ?? 0;
  t.code = t.code ?? null;                       // { handler: "<registered name>" } | null
  t.interaction_script = t.interaction_script ?? null; // thinga id of a code Thinga
  t.physics_profile = t.physics_profile ?? null;
  t.permissions = t.permissions || "private";
  t.owner = t.owner ?? null;
  t.origin = t.origin ?? null;
  t.signature = null; // (re)computed on PUT
  t.checksum = null;
  return t;
}

export function createThingaStore(dbOrPath = ":memory:") {
  const db = typeof dbOrPath === "string" ? new DatabaseSync(dbOrPath) : dbOrPath;

  db.exec(`
    CREATE TABLE IF NOT EXISTS thingas (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      content TEXT,
      axes TEXT,
      category_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_thinga_kind ON thingas(kind);
    CREATE INDEX IF NOT EXISTS idx_thinga_path ON thingas(category_path);
    CREATE TABLE IF NOT EXISTS thinga_links (from_id TEXT, link_kind TEXT, to_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_links_to ON thinga_links(to_id);
    CREATE INDEX IF NOT EXISTS idx_links_from ON thinga_links(from_id);
    CREATE TABLE IF NOT EXISTS thinga_meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  // ---- store identity: one ed25519 keypair, persisted, used to sign every PUT ----
  const keypair = loadOrCreateKeypair(db);

  const handlers = new Map(); // name -> (thinga, args, caps) => result
  const schemas = new Map();  // name -> (content, thinga) => true | throw

  const registerHandler = (name, fn) => { handlers.set(name, fn); return api; };
  const registerSchema = (name, validate) => { schemas.set(name, validate); return api; };

  // Reassemble a stored row into a full Thinga object.
  function rowToThinga(row) {
    if (!row) return null;
    const axes = row.axes ? JSON.parse(row.axes) : {};
    return {
      id: row.id, kind: row.kind, name: row.name, version: row.version,
      content: row.content ? JSON.parse(row.content) : {},
      category_path: row.category_path,
      created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
      ...axes,
    };
  }

  // ---- PUT — write or mutate (Ankhor §6.1) ----
  function put(input) {
    const t = normalize(input);

    // schema enforcement only where a kind opts in (Ankhor §7.2)
    if (t.schema && schemas.has(t.schema)) {
      const ok = schemas.get(t.schema)(t.content, t);
      if (ok !== true) throw new Error(`Thinga failed schema ${t.schema}: ${ok || "invalid"}`);
    }

    const existing = db.prepare("SELECT version, created_at FROM thingas WHERE id=?").get(t.id);
    const created_at = existing ? existing.created_at : nowISO();
    t.version = (existing ? existing.version : 0) + 1;
    const updated_at = nowISO();

    // sign the canonical form (everything except the signature/checksum themselves)
    const signable = { ...t, signature: null, checksum: null, updated_at };
    const checksum = "sha256:" + createHash("sha256").update(canonical(signable)).digest("hex");
    const signature = "ed25519:" + edSign(null, Buffer.from(checksum), keypair.privateKey).toString("base64");
    t.checksum = checksum;
    t.signature = signature;

    const axes = {};
    for (const f of AXIS_FIELDS) axes[f] = t[f];

    db.prepare(`
      INSERT INTO thingas (id, kind, name, version, content, axes, category_path, created_at, updated_at, deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind, name=excluded.name, version=excluded.version, content=excluded.content,
        axes=excluded.axes, category_path=excluded.category_path, updated_at=excluded.updated_at,
        deleted_at=NULL
    `).run(t.id, t.kind, t.name, t.version, JSON.stringify(t.content), JSON.stringify(axes),
           t.category_path, created_at, updated_at);

    // rebuild this Thinga's forward links (regret #6: reverse index from day one)
    db.prepare("DELETE FROM thinga_links WHERE from_id=?").run(t.id);
    const linkIns = db.prepare("INSERT INTO thinga_links (from_id, link_kind, to_id) VALUES (?,?,?)");
    for (const l of t.links) if (l && l.to) linkIns.run(t.id, l.kind || "links_to", l.to);
    for (const pid of t.parents) if (pid) linkIns.run(t.id, "child_of", pid);

    notifySubscribers(t.id);
    return t.id;
  }

  // ---- GET — read, optionally inline descendants to depth N (Ankhor §6.2) ----
  function get(id, depth = 0) {
    const row = db.prepare("SELECT * FROM thingas WHERE id=? AND deleted_at IS NULL").get(id);
    const t = rowToThinga(row);
    if (!t) return null;
    if (depth > 0 && Array.isArray(t.children) && t.children.length) {
      t.children = t.children.map((cid) => get(cid, depth - 1)).filter(Boolean);
    }
    return t;
  }

  // ---- QUERY — GET with a predicate (Ankhor §6.4). Predicate is a fn(thinga)->bool. ----
  function query(predicate, { kind, includeDeleted = false } = {}) {
    const sql = kind
      ? "SELECT * FROM thingas WHERE kind=?" + (includeDeleted ? "" : " AND deleted_at IS NULL")
      : "SELECT * FROM thingas" + (includeDeleted ? "" : " WHERE deleted_at IS NULL");
    const rows = kind ? db.prepare(sql).all(kind) : db.prepare(sql).all();
    const all = rows.map(rowToThinga);
    return predicate ? all.filter(predicate) : all;
  }

  // ---- INVOKE — activate a Thinga's code (Ankhor §6.3) ----
  // Resolution order: interaction_script (a code Thinga) → inline code.handler → return content.
  // Handlers receive (thinga, args, caps) where caps = scoped { put, get, invoke, query }.
  function invoke(id, args = {}) {
    const t = get(id);
    if (!t) throw new Error(`INVOKE: no Thinga ${id}`);
    const caps = { put, get, invoke, query };

    if (t.interaction_script) {
      const script = get(t.interaction_script);
      if (script && script.code && handlers.has(script.code.handler)) {
        return handlers.get(script.code.handler)(t, args, caps); // original Thinga is the subject
      }
    }
    if (t.code && t.code.handler) {
      const fn = handlers.get(t.code.handler);
      if (!fn) throw new Error(`INVOKE: no handler "${t.code.handler}" registered for ${id}`);
      return fn(t, args, caps);
    }
    return t.content; // a pure-data Thinga returns its payload
  }

  // ---- DELETE — tombstone, never hard delete (Ankhor §6.4) ----
  function tombstone(id) {
    db.prepare("UPDATE thingas SET deleted_at=?, updated_at=? WHERE id=?").run(nowISO(), nowISO(), id);
    db.prepare("DELETE FROM thinga_links WHERE from_id=?").run(id);
    return true;
  }

  // ---- verify a Thinga's signature against the store key (trust axis) ----
  function verify(id) {
    const row = db.prepare("SELECT * FROM thingas WHERE id=?").get(id);
    const t = rowToThinga(row);
    if (!t || !t.checksum || !t.signature) return false;
    const sig = Buffer.from(t.signature.replace(/^ed25519:/, ""), "base64");
    return edVerify(null, Buffer.from(t.checksum), keypair.publicKey, sig);
  }

  // Anything linking TO this Thinga with kind "subscribes_to" gets INVOKEd on change.
  function notifySubscribers(id) {
    const subs = db.prepare("SELECT from_id FROM thinga_links WHERE to_id=? AND link_kind='subscribes_to'").all(id);
    for (const s of subs) { try { invoke(s.from_id, { changed: id }); } catch { /* a subscriber must not break the PUT */ } }
  }

  // Reverse containment/edges: who points AT this Thinga (the regret #6 index, read side).
  function incomingLinks(id, linkKind) {
    const rows = linkKind
      ? db.prepare("SELECT from_id, link_kind FROM thinga_links WHERE to_id=? AND link_kind=?").all(id, linkKind)
      : db.prepare("SELECT from_id, link_kind FROM thinga_links WHERE to_id=?").all(id);
    return rows;
  }

  const api = {
    db, put, get, query, invoke, tombstone, verify, incomingLinks,
    registerHandler, registerSchema,
    publicKey: keypair.publicKey,
    ANKHOR_VERSION,
  };
  return api;
}

// One ed25519 keypair per store, persisted in thinga_meta (PEM). Created on first run.
function loadOrCreateKeypair(db) {
  const row = db.prepare("SELECT value FROM thinga_meta WHERE key='ed25519_priv'").get();
  if (row) {
    const pub = db.prepare("SELECT value FROM thinga_meta WHERE key='ed25519_pub'").get();
    return {
      privateKey: crypto_importPem(row.value, "private"),
      publicKey: crypto_importPem(pub.value, "public"),
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  const ins = db.prepare("INSERT OR REPLACE INTO thinga_meta (key, value) VALUES (?,?)");
  ins.run("ed25519_priv", privPem);
  ins.run("ed25519_pub", pubPem);
  return { privateKey, publicKey };
}

// Re-import a PEM key object (node:crypto KeyObject) from its PEM string.
import { createPrivateKey, createPublicKey } from "node:crypto";
function crypto_importPem(pem, which) {
  return which === "private" ? createPrivateKey(pem) : createPublicKey(pem);
}
