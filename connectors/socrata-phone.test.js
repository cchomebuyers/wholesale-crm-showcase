// connectors/socrata-phone.test.js — the generic nationwide phone connector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { socrataPhoneConnector, normalizeSocrataPhone, buildSocrataPhoneConnectors } from "./socrata-phone.js";

const cfg = { id: "test-src", domain: "data.example.gov", datasetId: "ab12-cd34",
  phoneCol: "biz_phone", nameCol: "owner", addrCol: "addr", state: "FL", city: "TESTCITY" };

test("normalize strips non-digits, drops sub-10-digit junk, maps name/addr", () => {
  assert.equal(normalizeSocrataPhone(cfg, { biz_phone: "(352) 519-5852", owner: "ACME", addr: "1 MAIN" }).phone, "3525195852");
  assert.equal(normalizeSocrataPhone(cfg, { biz_phone: "123", owner: "X" }), null); // too short
  assert.equal(normalizeSocrataPhone(cfg, { owner: "X" }), null); // no phone
  const n = normalizeSocrataPhone(cfg, { biz_phone: "3525195852", owner: "ACME", addr: "1 MAIN" });
  assert.equal(n.name, "ACME"); assert.equal(n.state, "FL"); assert.equal(n.source_id, "test-src");
});

test("harvest paginates with phone filter and returns normalized phone leads", async () => {
  let captured;
  const fetchImpl = async (u) => { captured = u; return { ok: true, json: async () => [
    { biz_phone: "3525195852", owner: "ACME LLC", addr: "1 MAIN ST" },
    { biz_phone: null, owner: "NOPHONE" },
  ] }; };
  const conn = socrataPhoneConnector(cfg, { fetchImpl });
  assert.equal(conn.type, "public-contact");
  const rows = await conn.harvest({ limit: 1000, offset: 2000 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "3525195852");
  assert.equal(captured.searchParams.get("$where"), "biz_phone IS NOT NULL");
  assert.equal(captured.searchParams.get("$offset"), "2000");
  assert.equal(captured.searchParams.get("$order"), ":id");
});

test("buildSocrataPhoneConnectors skips incomplete configs", () => {
  const conns = buildSocrataPhoneConnectors([cfg, { id: "bad" }, { id: "ok2", domain: "d", datasetId: "x", phoneCol: "p" }]);
  assert.equal(conns.length, 2);
});
