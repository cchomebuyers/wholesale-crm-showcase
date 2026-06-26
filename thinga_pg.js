// thinga_pg.js — the Postgres-backed ankhor.v1 runtime (async).
//
// Same six-axis Thinga, same three operations (PUT/GET/INVOKE), same signing — but on PostgreSQL with
// JSONB columns and a GIN index for fast content lookup, plus btree indexes on kind/category_path and
// the reverse-link table. Mirrors thinga.js's interface, but every method is async (pg is async).
// Pure helpers (canonical/normalize/AXIS_FIELDS) are reused from thinga.js — single source of truth.
//
// Schema + indexes are created on connect (idempotent). Set DATABASE_URL to point at the new database.

import pg from "pg";
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify,
  createPrivateKey, createPublicKey } from "node:crypto";
import { AXIS_FIELDS, canonical, normalize, ANKHOR_VERSION } from "./thinga.js";

export { ANKHOR_VERSION };

export async function createThingaStorePg(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("createThingaStorePg requires a DATABASE_URL / connection string");
  const pool = new pg.Pool({ connectionString, max: 10 });
  const q = (text, params) => pool.query(text, params);

  // ---- schema + fast-lookup indexes (idempotent) ----
  await q(`
    CREATE TABLE IF NOT EXISTS thingas (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      name          TEXT,
      version       INTEGER NOT NULL DEFAULT 1,
      content       JSONB,
      axes          JSONB,
      category_path TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_thinga_kind   ON thingas (kind)          WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_thinga_path   ON thingas (category_path) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_thinga_content_gin ON thingas USING GIN (content jsonb_path_ops);
    CREATE TABLE IF NOT EXISTS thinga_links (from_id TEXT, link_kind TEXT, to_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_links_to   ON thinga_links (to_id);
    CREATE INDEX IF NOT EXISTS idx_links_from ON thinga_links (from_id);
    CREATE TABLE IF NOT EXISTS thinga_meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  const keypair = await loadOrCreateKeypair(q);
  const handlers = new Map();
  const schemas = new Map();
  const registerHandler = (name, fn) => { handlers.set(name, fn); return api; };
  const registerSchema = (name, validate) => { schemas.set(name, validate); return api; };

  function rowToThinga(row) {
    if (!row) return null;
    const axes = row.axes || {};
    return {
      id: row.id, kind: row.kind, name: row.name, version: row.version,
      content: row.content || {},
      category_path: row.category_path,
      created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
      ...axes,
    };
  }

  async function put(input) {
    const t = normalize(input);
    if (t.schema && schemas.has(t.schema)) {
      const ok = schemas.get(t.schema)(t.content, t);
      if (ok !== true) throw new Error(`Thinga failed schema ${t.schema}: ${ok || "invalid"}`);
    }
    const ex = await q("SELECT version FROM thingas WHERE id=$1", [t.id]);
    t.version = (ex.rows[0] ? ex.rows[0].version : 0) + 1;

    const signable = { ...t, signature: null, checksum: null };
    const checksum = "sha256:" + createHash("sha256").update(canonical(signable)).digest("hex");
    const signature = "ed25519:" + edSign(null, Buffer.from(checksum), keypair.privateKey).toString("base64");
    t.checksum = checksum; t.signature = signature;

    const axes = {}; for (const f of AXIS_FIELDS) axes[f] = t[f];
    await q(
      `INSERT INTO thingas (id, kind, name, version, content, axes, category_path, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), NULL)
       ON CONFLICT (id) DO UPDATE SET
         kind=EXCLUDED.kind, name=EXCLUDED.name, version=EXCLUDED.version, content=EXCLUDED.content,
         axes=EXCLUDED.axes, category_path=EXCLUDED.category_path, updated_at=now(), deleted_at=NULL`,
      [t.id, t.kind, t.name, t.version, JSON.stringify(t.content), JSON.stringify(axes), t.category_path],
    );

    await q("DELETE FROM thinga_links WHERE from_id=$1", [t.id]);
    for (const l of t.links) if (l && l.to) await q("INSERT INTO thinga_links (from_id, link_kind, to_id) VALUES ($1,$2,$3)", [t.id, l.kind || "links_to", l.to]);
    for (const pid of t.parents) if (pid) await q("INSERT INTO thinga_links (from_id, link_kind, to_id) VALUES ($1,'child_of',$2)", [t.id, pid]);

    await notifySubscribers(t.id);
    return t.id;
  }

  async function get(id, depth = 0) {
    const r = await q("SELECT * FROM thingas WHERE id=$1 AND deleted_at IS NULL", [id]);
    const t = rowToThinga(r.rows[0]);
    if (!t) return null;
    if (depth > 0 && Array.isArray(t.children) && t.children.length) {
      t.children = (await Promise.all(t.children.map((cid) => get(cid, depth - 1)))).filter(Boolean);
    }
    return t;
  }

  // QUERY — fast paths use the indexes. `where` may be { kind, contains } where `contains` is a
  // JSONB object matched with the @> operator (uses the GIN index). Optional JS predicate refines.
  async function query(predicate, { kind, contains, includeDeleted = false } = {}) {
    const clauses = []; const params = []; let i = 1;
    if (!includeDeleted) clauses.push("deleted_at IS NULL");
    if (kind) { clauses.push(`kind = $${i++}`); params.push(kind); }
    if (contains) { clauses.push(`content @> $${i++}`); params.push(JSON.stringify(contains)); } // GIN
    const sql = "SELECT * FROM thingas" + (clauses.length ? " WHERE " + clauses.join(" AND ") : "");
    const r = await q(sql, params);
    const all = r.rows.map(rowToThinga);
    return predicate ? all.filter(predicate) : all;
  }

  async function invoke(id, args = {}) {
    const t = await get(id);
    if (!t) throw new Error(`INVOKE: no Thinga ${id}`);
    const caps = { put, get, invoke, query };
    if (t.interaction_script) {
      const script = await get(t.interaction_script);
      if (script && script.code && handlers.has(script.code.handler)) return handlers.get(script.code.handler)(t, args, caps);
    }
    if (t.code && t.code.handler) {
      const fn = handlers.get(t.code.handler);
      if (!fn) throw new Error(`INVOKE: no handler "${t.code.handler}" registered for ${id}`);
      return fn(t, args, caps);
    }
    return t.content;
  }

  async function tombstone(id) {
    await q("UPDATE thingas SET deleted_at=now(), updated_at=now() WHERE id=$1", [id]);
    await q("DELETE FROM thinga_links WHERE from_id=$1", [id]);
    return true;
  }

  async function verify(id) {
    const r = await q("SELECT * FROM thingas WHERE id=$1", [id]);
    const t = rowToThinga(r.rows[0]);
    if (!t || !t.checksum || !t.signature) return false;
    const sig = Buffer.from(t.signature.replace(/^ed25519:/, ""), "base64");
    return edVerify(null, Buffer.from(t.checksum), keypair.publicKey, sig);
  }

  async function incomingLinks(id, linkKind) {
    const r = linkKind
      ? await q("SELECT from_id, link_kind FROM thinga_links WHERE to_id=$1 AND link_kind=$2", [id, linkKind])
      : await q("SELECT from_id, link_kind FROM thinga_links WHERE to_id=$1", [id]);
    return r.rows;
  }

  const notifying = new Set();
  async function notifySubscribers(id) {
    if (notifying.has(id)) return;
    const r = await q("SELECT from_id FROM thinga_links WHERE to_id=$1 AND link_kind='subscribes_to'", [id]);
    if (!r.rows.length) return;
    notifying.add(id);
    try { for (const s of r.rows) { try { await invoke(s.from_id, { changed: id }); } catch { /* a subscriber must not break PUT */ } } }
    finally { notifying.delete(id); }
  }

  async function close() { await pool.end(); }

  const api = {
    pool, query, put, get, invoke, tombstone, verify, incomingLinks,
    registerHandler, registerSchema, close,
    publicKey: keypair.publicKey, ANKHOR_VERSION, dialect: "postgres",
  };
  return api;
}

async function loadOrCreateKeypair(q) {
  const r = await q("SELECT key, value FROM thinga_meta WHERE key IN ('ed25519_priv','ed25519_pub')");
  const map = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  if (map.ed25519_priv && map.ed25519_pub) {
    return { privateKey: createPrivateKey(map.ed25519_priv), publicKey: createPublicKey(map.ed25519_pub) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  await q("INSERT INTO thinga_meta (key,value) VALUES ('ed25519_priv',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [privPem]);
  await q("INSERT INTO thinga_meta (key,value) VALUES ('ed25519_pub',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [pubPem]);
  return { privateKey, publicKey };
}
