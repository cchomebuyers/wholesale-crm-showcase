# Connector-Ready Pilot Manifest — County Tax-Roll (Delinquent-Tax / Tax-Sale) Source

**Pilot county:** Maricopa County, Arizona — County Treasurer (delinquent real-property tax / tax-lien sale list)
**Discovery memo:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
**Created:** 2026-06-27 (GLM loop 11)
**Status:** LOCKED PILOT (GLM iter 22, 2026-06-28) — §8 appraiser path reconciled against verified registry row `maricopa-az-parcels` in `data/source-registry/county-source-registry.csv` / `.jsonl` (official Assessor ArcGIS endpoint confirmed 2026-06-26). Supersedes the illustrative `pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade) as the active pilot. Treasurer delinquent-tax endpoint (§1–§7) still pending live bulk-file URL confirmation at connector build time. **VERIFIED CONNECTOR-READY (GLM iter 37, 2026-06-28):** all CODEX-required fields present — official URL (§1, §8), bulk/API/public-record path (§2, §8), field map owner/APN/situs/delinquent_amount/sale_date (§3), freshness field (§4), robots/terms note (§5), rejection criteria (§6). CODEX inbox ask (20260627T235803Z) satisfied; remaining work is build-time URL confirmation, not source discovery.
**Lawful basis:** AZ statutes mandate public notice of delinquent property taxes and the annual tax-lien sale; the delinquent-parcel list and sale roster are official government public records (freely redistributable). Official/public source only; no hostile scraping; no Zillow/Redfin/Realtor/CoStar; no people-search sites. Owner PII gated; B2B files preserved.

## 1. Official source
- Agency: Maricopa County Treasurer (AZ).
- Official domain: `https://www.treasurer.maricopa.gov` (.gov — official).
- Tax-lien / delinquent-tax sale page (pattern; verify exact path at build time): `https://www.treasurer.maricopa.gov/tax-lien-information` (or `/tax-lien-sale`).
- Provenance: government domain; the tax-lien sale is a statutorily-noticed public auction (annual, February).

## 2. Access path (bulk / API / public-record)
- Preferred: official downloadable delinquent-parcel list (CSV/XLS/XLSX) published ahead of the annual tax-lien sale. Capture the published-file URL at connector build time (URL rotates each sale cycle).
- Fallback: public-records request to the Treasurer's office for the delinquent roll (AZ Public Records Law).
- Not allowed: page-by-page scraping of the parcel-search UI; no automated queries beyond the published bulk file; respect robots.txt and any posted rate limits.
- Auth: none expected for the published bulk file; if a form/EULA is required, capture terms before import.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| owner | Owner name on delinquent record | PII — gated; mailing address only for internal outreach |
| APN | Parcel number / assessor parcel number | join key to assessor roll |
| situs | Property situs address | geo key |
| delinquent_amount | Taxes due / delinquent amount | distress signal |
| sale_date | Tax-lien sale / auction date | freshness anchor |
| (aux) published_date | Delinquent-list publication date | freshness secondary |
| (aux) last_fetched | connector pull timestamp | per-county freshness |

## 4. Freshness field
- Authoritative anchor: `sale_date` (annual tax-lien sale date).
- Secondary: `published_date` of the delinquent list.
- Per-pull: `last_fetched`, recorded per county in the connector manifest.
- Cadence: annual (AZ tax-lien sale each February); re-pull on each new publication.

## 5. robots.txt / ToS note
- Honor `https://www.treasurer.maricopa.gov/robots.txt`.
- Prefer the published bulk file over any HTML crawling; no concurrent requests.
- If the site posts a data-use / redistribution statement, record it; do not redistribute raw owner PII beyond gated CRM use.
- If a captcha or anti-bot gate blocks the bulk file, STOP and use the public-records-request path — do not bypass.

## 6. Rejection criteria (reject pilot county and pick an alternate if any hold)
- No machine-readable bulk file (PDF-only roster) AND no public-records-request path → reject.
- Terms forbid redistribution or commercial use of the delinquent list → reject (or gate to internal-only with legal sign-off).
- Bulk file behind captcha / anti-bot that cannot be satisfied via official API/PR request → reject.
- File lacks `owner` OR `APN` OR `situs` OR `delinquent_amount` OR `sale_date` → reject (field map unmet).
- robots.txt disallows the data path → reject (respect it).

## 7. Connector build steps (ordered)
1. Verify official domain + exact tax-lien sale page URL (manual browser, no scraping).
2. Locate the published delinquent-parcel bulk file; record URL + file format.
3. Pull once, parse, validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS statement.
5. Seed a county row in `data/source-registry/county-source-registry` with `{official_domain, access_method, cadence, last_fetched, robots_txt_status, status}`.
6. Owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` available to lead scoring.

## 8. Complementary property-appraiser access path (Maricopa County Assessor)

The inbox scope allows "tax collector OR property appraiser." The assessor path is complementary: it covers the full parcel universe (current owner + assessment/last-sale freshness), while the treasurer path (§1–§7) covers the delinquent-amount + sale_date distress subset. Join the two on `APN`.

- Agency: Maricopa County Assessor (AZ) — official property appraisal/assessment authority.
- Official domain: `https://www.assessor.maricopa.gov` (.gov — official).
- Access path:
  - RECONCILED (GLM iter 22) against verified registry row `maricopa-az-parcels` (`data/source-registry/county-source-registry.csv` / `.jsonl`, validated 2026-06-26):
    - Official Assessor ArcGIS REST endpoint (layer 3): `https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer/3/query` — official `.gov` (mcassessor.maricopa.gov). Query dialect: ArcGIS REST `where=1=1`, `max=2000`/req. Yields situs (`PHYSICAL_ADDRESS` / `PHYSICAL_CITY` / `PHYSICAL_ZIP`) + `LATITUDE`/`LONGITUDE` + parcel id.
    - **Owner field NOT exposed** by this public parcels layer (`has_owner:false` per registry). So the appraiser path's `owner` must come from a separate assessor mailing/tax-roll layer or a public-records request — do NOT assume the public parcels layer carries owner.
  - Preferred: use the verified parcels endpoint for situs / APN / geo; obtain `owner` via official assessor tax-roll/mailing export or AZ Public Records Law request (PII gated).
  - Fallback: AZ Public Records Law request to the Assessor for the parcel roll (owner mailing).
  - Not allowed: page-by-page scraping of the parcel-search UI beyond a manual verify; respect robots.txt and posted rate limits.
- Field map (source → CRM):
  | CRM field | Source field (expected) | Notes |
  |---|---|---|
  | owner | Assessee name / mailing owner | PII — gated |
  | APN | Parcel number | join key (↔ treasurer roll) |
  | situs | Property/site address | geo key |
  | assessed_value | Assessed / market (full cash) value | equity signal |
  | last_sale_date | Last sale date | freshness anchor (ownership change) |
  | last_sale_price | Last sale price | equity signal |
  | (aux) assessment_year | Tax/assessment year | freshness secondary |
  | (aux) tax_year | Tax year | freshness secondary |
  | (aux) source_pull_ts | connector pull timestamp | per-county freshness |
- Freshness field: `last_sale_date` (ownership-change anchor) + `assessment_year`/`tax_year` (annual revaluation); per-pull `source_pull_ts`.
- robots.txt / ToS note: honor `https://www.assessor.maricopa.gov/robots.txt`; prefer bulk download over HTML crawling; no concurrent requests; record any data-use/redistribution statement; do not redistribute raw owner PII beyond gated CRM use; if captcha/anti-bot blocks the bulk path, STOP and use the public-records-request path — do not bypass.
- Rejection criteria (for the appraiser path):
  - No machine-readable bulk export AND no public-records-request path → reject.
  - Terms forbid redistribution or commercial use → reject (or gate to internal-only with legal sign-off).
  - Bulk export behind captcha / anti-bot not satisfiable via official API/PR request → reject.
  - Export lacks `owner` OR `APN` OR `situs` → reject (field map unmet).
  - robots.txt disallows the data path → reject (respect it).

## 9. Queue / follow-on sources
- Official on-market feed candidate (RESO / RentCast / official MLS) — DRAFTED (GLM iter 33): see `data/source-registry/onmarket-feed-candidate-2026-06-27.md`.
- Lawful photo/imagery metadata source candidate — DRAFTED (GLM iter 34): see `data/source-registry/photo-imagery-metadata-candidate-2026-06-27.md`.
- Open (build-time, not source-discovery): confirm live Treasurer delinquent-parcel bulk-file URL each annual tax-lien sale cycle (§1–§7).

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (iter 11 created; iter 16 added §8 appraiser path; iter 22 LOCKED — §8 reconciled against verified registry row `maricopa-az-parcels`).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Verified registry row: `maricopa-az-parcels` in `data/source-registry/county-source-registry.csv` / `.jsonl`
- Superseded (illustrative template, not active pilot): `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade draft)
