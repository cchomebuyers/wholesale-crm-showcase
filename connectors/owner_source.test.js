// connectors/owner_source.test.js — generic owner-join.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSitus, isPlaceholderOwner, normalizeOwnerHit, ownerSourceConnector, buildOwnerSources, houseStreetKey } from "./owner_source.js";

test("houseStreetKey = house# + first street word, directionals dropped", () => {
  assert.equal(houseStreetKey("11306 S DRAKE AVE"), "11306 DRAKE");
  assert.equal(houseStreetKey("1120 E 47TH ST"), "1120 47TH");
  assert.equal(houseStreetKey("no number here"), null);
});

test("lookup falls back to anchored LIKE when exact match misses", async () => {
  const seen = [];
  const stub = async (u) => {
    const where = u.searchParams.get("$where"); seen.push(where);
    // exact '=' query misses; the LIKE fallback finds the row
    if (/like/i.test(where)) return { ok: true, json: async () => ([{ owner_address_name: "TERRENCE SHANKLIN", prop_address_full: "11306 S DRAKE AVE" }]) };
    return { ok: true, json: async () => ([]) };
  };
  const c = ownerSourceConnector({ id: "cook", domain: "d", datasetId: "i", addrCol: "prop_address_full", ownerCol: "owner_address_name", addrStyle: "raw" }, { fetchImpl: stub });
  const r = await c.lookup("11306 DRAKE"); // property stored without direction/suffix
  assert.equal(r.owner_name, "TERRENCE SHANKLIN");
  assert.equal(seen.length, 2);                 // tried exact, then fallback
  assert.match(seen[1], /like/i);
  assert.match(seen[1], /11306 %DRAKE%/);
});

test("fuzzyFallback:false disables the second pass", async () => {
  let calls = 0;
  const stub = async () => { calls++; return { ok: true, json: async () => ([]) }; };
  const c = ownerSourceConnector({ id: "x", domain: "d", datasetId: "i", addrCol: "a", ownerCol: "o", fuzzyFallback: false }, { fetchImpl: stub });
  assert.equal(await c.lookup("11306 S DRAKE AVE"), null);
  assert.equal(calls, 1);                        // only the exact pass
});

test("normalizeSitus expands suffix to full (PLUTO style)", () => {
  assert.equal(normalizeSitus("99 WALL ST", "full"), "99 WALL STREET");
  assert.equal(normalizeSitus("153 Chambers St", "full"), "153 CHAMBERS STREET");
  assert.equal(normalizeSitus("6616 S Evans Ave", "full"), "6616 S EVANS AVENUE");
});

test("normalizeSitus abbreviates for abbr-style sources", () => {
  assert.equal(normalizeSitus("99 WALL STREET", "abbr"), "99 WALL ST");
});

test("normalizeSitus strips unit/apt tail and city suffix", () => {
  assert.equal(normalizeSitus("99 WALL ST APT 5, NEW YORK NY 10005", "full"), "99 WALL STREET");
  assert.equal(normalizeSitus("12 Main St #3", "full"), "12 MAIN STREET");
});

test("isPlaceholderOwner rejects junk owner strings", () => {
  assert.equal(isPlaceholderOwner("UNAVAILABLE OWNER"), true);
  assert.equal(isPlaceholderOwner("N/A"), true);
  assert.equal(isPlaceholderOwner(""), true);
  assert.equal(isPlaceholderOwner("153 CHAMBERS CONDO LLC"), false);
});

test("normalizeOwnerHit returns owner or null on placeholder", () => {
  const cfg = { id: "nyc-pluto", ownerCol: "ownername", apnCol: "bbl" };
  assert.equal(normalizeOwnerHit(cfg, { ownername: "UNAVAILABLE OWNER" }), null);
  const hit = normalizeOwnerHit(cfg, { ownername: "ACME LLC", bbl: "1000337501" });
  assert.equal(hit.owner_name, "ACME LLC");
  assert.equal(hit.apn, "1000337501");
  assert.equal(hit.owner_source, "nyc-pluto");
});

test("ownerSourceConnector.lookup returns owner via stub fetch and queries normalized situs", async () => {
  let capturedUrl;
  const stub = async (u) => { capturedUrl = u; return { ok: true, json: async () => ([{ ownername: "153 CHAMBERS CONDO LLC", address: "153 CHAMBERS STREET" }]) }; };
  const c = ownerSourceConnector({ id: "nyc-pluto", domain: "data.cityofnewyork.us", datasetId: "64uk-42ks", addrCol: "address", ownerCol: "ownername", addrStyle: "full" }, { fetchImpl: stub });
  const r = await c.lookup("153 Chambers St");
  assert.equal(r.owner_name, "153 CHAMBERS CONDO LLC");
  assert.match(capturedUrl.searchParams.get("$where"), /153 CHAMBERS STREET/);
});

test("ownerSourceConnector.lookup adds latestBy ordering when configured (Cook year roll)", async () => {
  let capturedUrl;
  const stub = async (u) => { capturedUrl = u; return { ok: true, json: async () => ([{ owner_address_name: "MIGUEL FLORES" }]) }; };
  const c = ownerSourceConnector({ id: "cook", domain: "datacatalog.cookcountyil.gov", datasetId: "3723-97qp", addrCol: "prop_address_full", ownerCol: "owner_address_name", addrStyle: "raw", latestBy: "year" }, { fetchImpl: stub });
  const r = await c.lookup("1429 N SPRINGFIELD AVE");
  assert.equal(r.owner_name, "MIGUEL FLORES");
  assert.equal(capturedUrl.searchParams.get("$order"), "year DESC");
  assert.equal(capturedUrl.searchParams.get("$where"), "upper(prop_address_full)=upper('1429 N SPRINGFIELD AVE')");
});

test("ownerSourceConnector.lookup returns null on empty result or fetch failure", async () => {
  const empty = ownerSourceConnector({ id: "x", domain: "d", datasetId: "i", addrCol: "address", ownerCol: "ownername" }, { fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  assert.equal(await empty.lookup("1 Main St"), null);
  const boom = ownerSourceConnector({ id: "x", domain: "d", datasetId: "i", addrCol: "address", ownerCol: "ownername" }, { fetchImpl: async () => { throw new Error("net"); } });
  assert.equal(await boom.lookup("1 Main St"), null);
});

test("buildOwnerSources skips incomplete configs", () => {
  const built = buildOwnerSources([
    { id: "ok", domain: "d", datasetId: "i", addrCol: "a", ownerCol: "o" },
    { id: "bad-no-owner", domain: "d", datasetId: "i", addrCol: "a" },
    null,
  ]);
  assert.equal(built.length, 1);
  assert.equal(built[0].id, "ok");
});
