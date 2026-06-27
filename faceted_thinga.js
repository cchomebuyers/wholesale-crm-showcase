// faceted_thinga.js — the faceted Thinga registry foundation.
//
// Aligns this repo with the canonical faceted architecture (ankhor88/FACETED_THINGA_ARCHITECTURE.md)
// and the Ankhor substrate (yearTwo777/synthesis/ANKHOR_ARCHITECTURE.md). It is the recursive,
// content-addressed, shard-routable registry meant to back EVERYTHING long-term — leads today, a
// 3D world graph + council-monitored shared state later. Pure Node (no React/Supabase/DB coupling):
//
//   • content-hash identity  — every Thinga's id IS the sha256 of its content (the "unique hash id")
//   • facet parser registry  — explicit registration, no import side-effects (the arch's #1 rule)
//   • meta-parser            — routes $header.$facets to parsers, partial success, recoverable errors
//   • pointer resolver       — $refs: uuid:/id:/path:/title:
//   • recursive parent/child — children/parents are first-class; walk() traverses the tree
//   • shard routing          — deterministic now (hash%N); pluggable semantic router later (pgvector)

import { createHash } from "node:crypto";

// Deterministic stringify (sorted keys) so the content hash is stable across runs/machines.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

// Content-addressed id. Same content → same id, everywhere. This is the unique hash id.
export function contentHash(obj) {
  return "sha256:" + createHash("sha256").update(canonical(obj)).digest("hex");
}

// Facet parser registry — matches ankhor88/src/parsers/core/registry.ts contract exactly:
// explicit initialize() (no import side-effects), usage tracking, get/has/list/isInitialized/reset.
// A FacetParser = { id, name?, required?, validate(data)->{ success, data?, error?, warnings? }, preprocess? }.
export function createFacetRegistry() {
  const parsers = new Map(); // id -> { parser, registeredAt, usageCount }
  let initialized = false;
  const reg = {
    register(parser) {
      if (!parser || !parser.id || typeof parser.validate !== "function") throw new Error("register({ id, validate })");
      if (parsers.has(parser.id)) return reg; // already registered → skip (no double-registration)
      parsers.set(parser.id, { parser, registeredAt: new Date(), usageCount: 0 });
      return reg;
    },
    initialize(list = []) { if (initialized) return reg; for (const p of list) reg.register(p); initialized = true; return reg; },
    get(id) { const e = parsers.get(id); if (e) { e.usageCount++; return e.parser; } return undefined; },
    has: (id) => parsers.has(id),
    list: () => [...parsers.keys()],
    isInitialized: () => initialized,
    getStats: () => Object.fromEntries([...parsers].map(([id, e]) => [id, { usageCount: e.usageCount, registeredAt: e.registeredAt }])),
    reset() { parsers.clear(); initialized = false; return reg; },
  };
  return reg;
}

// Assemble a faceted Thinga. $header = identity + relations; facets = typed data blocks.
export function makeThinga({ kind, type = null, name = null, content = {}, facets = {}, parents = [], children = [] }) {
  if (!kind) throw new Error("Thinga requires a kind");
  const body = { kind, type, name, content, facets, parents, children };
  const id = contentHash(body); // identity derived from content
  return {
    $header: {
      id, hash: id, kind, type, name,
      $facets: Object.keys(facets),
      parents, children,
      created_at: new Date().toISOString(),
    },
    content,
    facets,
  };
}

// Meta-parser: route each facet to its registered parser. Partial success in lenient mode.
export function parseThinga(thinga, registry, { mode = "lenient" } = {}) {
  const facets = (thinga && thinga.facets) || {};
  const parsed = {};
  const errors = [];
  const warnings = [];
  for (const [facetName, data] of Object.entries(facets)) {
    const p = registry.get(facetName);
    if (!p) { errors.push({ facet: facetName, error: "no_parser" }); if (mode === "strict") throw new Error(`no parser for facet "${facetName}"`); continue; }
    const input = typeof p.preprocess === "function" ? p.preprocess(data) : data;
    let res; try { res = p.validate(input); } catch (e) { res = { success: false, error: String(e.message || e) }; }
    if (res && Array.isArray(res.warnings)) for (const w of res.warnings) warnings.push({ facet: facetName, warning: w });
    if (!res || res.success !== true) {
      errors.push({ facet: facetName, error: (res && res.error) || "invalid" });
      if (mode === "strict") throw new Error(`facet "${facetName}": ${(res && res.error) || "invalid"}`);
      continue;
    }
    parsed[facetName] = res.data !== undefined ? res.data : input;
  }
  return { ok: errors.length === 0, parsed, errors, warnings, partial: errors.length > 0 && Object.keys(parsed).length > 0 };
}

// Pointer resolver: a $ref string → an entity, via a store of lookup fns. Schemes: uuid:/id:/path:/title:.
export function resolvePointer(ref, store = {}) {
  if (typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const scheme = ref.slice(0, i), val = ref.slice(i + 1);
  if ((scheme === "uuid" || scheme === "id") && store.byId) return store.byId(val) ?? null;
  if (scheme === "path" && store.byPath) return store.byPath(val) ?? null;
  if (scheme === "title" && store.byTitle) return store.byTitle(val) ?? null;
  return null;
}

// Shard routing — deterministic hash%N now; pass a semantic router fn (e.g. pgvector cluster) later.
export function shardKey(thinga, { shards = 16, router = null } = {}) {
  if (typeof router === "function") return router(thinga);
  const h = (thinga && thinga.$header && thinga.$header.hash) || contentHash(thinga);
  return parseInt(h.replace(/^sha256:/, "").slice(0, 8), 16) % shards;
}

// Recursive traversal. children may be inline Thingas or ids (resolved via getChild).
export function walk(thinga, visit, getChild = null) {
  if (!thinga) return;
  visit(thinga);
  const kids = (thinga.$header && thinga.$header.children) || [];
  for (const c of kids) {
    const child = (c && typeof c === "object") ? c : (getChild ? getChild(c) : null);
    if (child) walk(child, visit, getChild);
  }
}
