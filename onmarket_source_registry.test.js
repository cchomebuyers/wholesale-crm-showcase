import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOnMarketReadiness, parseOnMarketManifest, renderOnMarketReadinessMarkdown } from "./onmarket_source_registry.js";

test("parseOnMarketManifest extracts status, fields, freshness, and blockers", () => {
  const manifest = `# Connector-Ready Pilot Manifest - Official On-Market Feed
**Status:** VERIFIED CONNECTOR-READY - all fields confirmed.
**Lawful basis:** Official API under DUA.

## 3. Field map
| CRM field | Source field | Notes |
|---|---|---|
| listing_id | ListingId | dedupe |
| situs | Address | join key |
| list_price | ListPrice | price |
| status | Status | lifecycle |
| list_date | ListingDate | freshness |

## 4. Freshness field
- ModificationTimestamp

## 7. Connector build steps
1. Obtain OAuth2 credentials.
2. Run delta pull.
`;

  const out = parseOnMarketManifest(manifest, "pilot.md");
  assert.equal(out.status, "verified");
  assert.ok(out.required_fields.includes("situs"));
  assert.ok(out.freshness_anchors.includes("ModificationTimestamp"));
  assert.ok(out.blockers.some((b) => b.includes("Obtain OAuth2 credentials")));
  assert.ok(out.readiness_score > 50);
});

test("buildOnMarketReadiness ranks verified manifests ahead of draft manifests", () => {
  const verified = `# RESO
**Status:** VERIFIED CONNECTOR-READY.
**Lawful basis:** MLS DUA.
## 3. Field map
| CRM field | Source field | Notes |
|---|---|---|
| listing_id | id | |
| situs | address | |
| list_price | price | |
| status | status | |
| list_date | date | |
## 4. Freshness field
- ModificationTimestamp
`;
  const draft = `# HUD
**Status:** DRAFT PILOT - pending FOIA.
**Lawful basis:** Official agency.
## 3. Field map
| CRM field | Source field | Notes |
|---|---|---|
| listing_id | id | |
| situs | address | |
| list_price | price | |
| status | status | |
| list_date | date | |
## 4. Freshness field
- list_date
`;

  const report = buildOnMarketReadiness([
    { file: "hud.md", text: draft },
    { file: "reso.md", text: verified },
  ]);
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.verified, 1);
  assert.equal(report.sources[0].title, "RESO");
});

test("draft manifests stay draft when the status line says pending verified", () => {
  const draft = `# HUD
**Status:** DRAFT PILOT - pending VERIFIED until FOIA cadence confirmed.
**Lawful basis:** Official agency.
`;
  const out = parseOnMarketManifest(draft, "hud.md");
  assert.equal(out.status, "draft");
});

test("verified manifests stay verified when the status line mentions previous draft", () => {
  const verified = `# RESO
**Status:** VERIFIED CONNECTOR-READY - all fields confirmed. Previously DRAFT PILOT.
`;
  const out = parseOnMarketManifest(verified, "reso.md");
  assert.equal(out.status, "verified");
});

test("official URLs ignore secondary source sections", () => {
  const manifest = `# RESO
**Status:** VERIFIED CONNECTOR-READY.
## 1. Official source
- Protocol only.
## 8. Secondary gap-fill
- RentCast https://api.rentcast.io/v1/
`;
  const out = parseOnMarketManifest(manifest, "reso.md");
  assert.deepEqual(out.official_urls, []);
});

test("renderOnMarketReadinessMarkdown cites source files", () => {
  const report = buildOnMarketReadiness([{ file: "x.md", text: "# X\n**Status:** DRAFT PILOT.\n" }]);
  const md = renderOnMarketReadinessMarkdown(report);
  assert.match(md, /On-Market Source Readiness/);
  assert.match(md, /Citation: x\.md/);
});
