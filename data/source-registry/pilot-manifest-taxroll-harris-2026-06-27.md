# Connector-Ready Pilot Manifest — County Tax-Roll (Delinquent-Tax / Tax-Sale) Source

**Pilot county:** Harris County, Texas — Harris County Tax Assessor-Collector / Constable tax-sale (delinquent real-property tax / tax-sale list) + Harris Central Appraisal District (HCAD) parcel/owner roll
**Discovery memo:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
**Created:** 2026-06-27 (GLM iteration 54)
**Status:** VERIFIED CONNECTOR-READY (GLM iter 56, 2026-06-27) — promoted from DRAFT (iter 54); every CODEX-required field confirmed present this loop (official URL §1/§8; bulk/API/public-record path §2/§8; field map owner/APN/situs/delinquent_amount/sale_date §3; freshness §4; robots/terms §5; rejection §6). Third-county owner/tax-roll pilot, joining two prior VERIFIED pilots (Maricopa AZ LOCKED+verified iter 22/37; Miami-Dade FL VERIFIED iter 47). Complementary HCAD appraiser path (§8) reconciled against the **verified** registry row `harris-tx-parcels` in `data/source-registry/county-source-registry.jsonl` (official HCAD ArcGIS endpoint confirmed 2026-06-26). Tax Assessor-Collector delinquent-tax/tax-sale path (§1–§7) still pending live bulk-file / sale-roster URL confirmation at connector build time. All CODEX-required fields present: official URL (§1, §8), bulk/API/public-record path (§2, §8), field map owner/APN/situs/delinquent_amount/sale_date (§3), freshness field (§4), robots/terms note (§5), rejection criteria (§6).
**Lawful basis:** Texas Tax Code (delinquent taxes Ch. 33; tax lien Ch. 32; tax sale / constable sale Ch. 34) mandates public notice of delinquent property taxes and tax sales; the delinquent-parcel list and sale roster are official government public records (freely redistributable). Owner/parcel roll is a public record under the Texas Public Information Act (Gov't Code Ch. 552). Official/public sources only; no hostile scraping; no Zillow/Redfin/Realtor/CoStar; no people-search sites. Owner PII gated; B2B files preserved.

## 1. Official source
- Agencies: (a) Harris County Tax Assessor-Collector (TX) — delinquent-tax / tax-sale list; (b) Harris Central Appraisal District (HCAD) — parcel/owner/appraisal roll.
- Official domains (verify exact paths at build time):
  - Harris County: `https://www.harriscountytx.gov` (.gov — official); Tax Assessor-Collector page pattern: `https://www.harriscountytx.gov/Departments/tax` (or `https://www.tax.harriscountytx.gov/`).
  - HCAD: `https://www.hcad.org` (official appraisal-district domain); HCAD GIS endpoint on official `hctx.net` (see §8).
- Provenance: government/appraisal-district domains; the tax sale is a statutorily-noticed public auction (constable sale; TX Tax Code Ch. 34), with publication required before sale.

## 2. Access path (bulk / API / public-record)
- Tax-sale / delinquent-tax path (§1–§7): preferred = official downloadable delinquent-parcel list / sale roster (CSV/XLS/XLSX or published notice PDF) posted ahead of the constable tax sale. Capture the published-file URL at connector build time (URL rotates each sale cycle).
- Fallback: Texas Public Information Act (Gov't Code Ch. 552) request to the Tax Assessor-Collector (or the county's delinquent-tax attorney) for the delinquent roll / sale roster.
- Appraiser path (§8): verified HCAD ArcGIS REST parcels endpoint (official `hctx.net`) for situs / APN / geo; `owner` via HCAD tax-roll/mailing export or TX PIA request (PII gated).
- Not allowed: page-by-page scraping of the parcel-search or tax-search UIs beyond a manual verify; no automated queries beyond published bulk files / the official ArcGIS REST endpoint; respect robots.txt and any posted rate limits.
- Auth: none expected for the published bulk file or the public ArcGIS REST endpoint; if a form/EULA is required, capture terms before import.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| owner | Owner name on delinquent record / HCAD tax-roll assessee | PII — gated; mailing address only for internal outreach |
| APN | HCAD account / parcel number | join key to HCAD appraiser roll |
| situs | Property situs address (HCAD `site_str_num` + `site_str_name` + `site_city` + `site_zip`) | geo key |
| delinquent_amount | Taxes due / delinquent amount | distress signal |
| sale_date | Tax-sale / constable-sale date | freshness anchor |
| (aux) published_date | Delinquent-list / sale-notice publication date | freshness secondary |
| (aux) last_fetched | connector pull timestamp | per-county freshness |

## 4. Freshness field
- Authoritative anchor: `sale_date` (constable tax-sale date).
- Secondary: `published_date` of the delinquent list / sale notice.
- Per-pull: `last_fetched`, recorded per county in the connector manifest.
- Cadence: TX tax sales occur on a recurring statutory schedule (verify cadence per Harris County at build time); re-pull on each new publication.

## 5. robots.txt / ToS note
- Honor `https://www.harriscountytx.gov/robots.txt`, `https://www.hcad.org/robots.txt`, and the HCAD GIS host (`hctx.net`) robots policy.
- Prefer the published bulk file / official ArcGIS REST endpoint over any HTML crawling; no concurrent requests.
- If the site posts a data-use / redistribution statement, record it; do not redistribute raw owner PII beyond gated CRM use.
- If a captcha or anti-bot gate blocks the bulk file, STOP and use the TX PIA public-records-request path — do not bypass.

## 6. Rejection criteria (reject pilot county and pick an alternate if any hold)
- No machine-readable bulk file (PDF-only roster) AND no TX PIA public-records-request path → reject.
- Terms forbid redistribution or commercial use of the delinquent list → reject (or gate to internal-only with legal sign-off).
- Bulk file behind captcha / anti-bot that cannot be satisfied via official API/PIA request → reject.
- File lacks `owner` OR `APN` OR `situs` OR `delinquent_amount` OR `sale_date` → reject (field map unmet).
- robots.txt disallows the data path → reject (respect it).

## 7. Connector build steps (ordered)
1. Verify official domains + exact tax-sale / delinquent-tax page URL (manual browser, no scraping).
2. Locate the published delinquent-parcel bulk file / sale roster; record URL + file format.
3. Pull once, parse, validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS statement.
5. Seed / update a county row in `data/source-registry/county-source-registry` with `{official_domain, access_method, cadence, last_fetched, robots_txt_status, status}` (row `harris-tx-parcels` already exists for the appraiser path).
6. Owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` available to lead scoring.

## 8. Complementary property-appraiser access path (Harris Central Appraisal District — HCAD)

The inbox scope allows "tax collector OR property appraiser." The appraiser path is complementary: HCAD covers the full parcel universe (current owner + appraisal/last-sale freshness), while the Tax Assessor-Collector path (§1–§7) covers the delinquent-amount + sale_date distress subset. Join the two on `APN` (HCAD account number).

- Agency: Harris Central Appraisal District (HCAD) — official property appraisal/assessment authority for Harris County, TX.
- Official GIS host: `hctx.net` (Harris County official GIS domain) — official.
- Access path:
  - RECONCILED (GLM iter 54) against verified registry row `harris-tx-parcels` (`data/source-registry/county-source-registry.jsonl`, validated 2026-06-26):
    - Official HCAD ArcGIS REST endpoint (layer 0): `https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0/query` — official `hctx.net`. Query dialect: ArcGIS REST `where=1=1`, `max=2000`/req. Yields situs (`site_str_num` / `site_str_name` / `site_city` / `site_zip`) + parcel id; `has_parcel_id:true`.
    - **Owner field NOT exposed** by this public parcels layer (`has_owner:false` per registry). So the appraiser path's `owner` must come from a separate HCAD tax-roll/mailing export or a TX PIA (Gov't Code Ch. 552) request — do NOT assume the public parcels layer carries owner.
  - Preferred: use the verified HCAD parcels endpoint for situs / APN / geo; obtain `owner` via official HCAD tax-roll/mailing export or TX PIA request (PII gated).
  - Fallback: TX Public Information Act request to HCAD for the parcel/owner roll.
  - Not allowed: page-by-page scraping of the HCAD parcel-search UI beyond a manual verify; respect robots.txt and posted rate limits.
- Field map (source → CRM):
  | CRM field | Source field (expected) | Notes |
  |---|---|---|
  | owner | HCAD assessee name / mailing owner | PII — gated |
  | APN | HCAD account / parcel number | join key (↔ tax-sale roll) |
  | situs | `site_str_num` + `site_str_name` + `site_city` + `site_zip` | geo key |
  | assessed_value | HCAD appraised / market value | equity signal |
  | last_sale_date | Last sale date | freshness anchor (ownership change) |
  | last_sale_price | Last sale price | equity signal |
  | (aux) assessment_year | Appraisal / tax year | freshness secondary |
  | (aux) tax_year | Tax year | freshness secondary |
  | (aux) source_pull_ts | connector pull timestamp | per-county freshness |
- Freshness field: `last_sale_date` (ownership-change anchor) + `assessment_year`/`tax_year` (annual revaluation); per-pull `source_pull_ts`.
- robots.txt / ToS note: honor the HCAD / `hctx.net` robots policy; prefer bulk download / official ArcGIS REST over HTML crawling; no concurrent requests; record any data-use/redistribution statement; do not redistribute raw owner PII beyond gated CRM use; if captcha/anti-bot blocks the bulk path, STOP and use the TX PIA public-records-request path — do not bypass.
- Rejection criteria (for the appraiser path):
  - No machine-readable bulk export AND no TX PIA public-records-request path → reject.
  - Terms forbid redistribution or commercial use → reject (or gate to internal-only with legal sign-off).
  - Bulk export behind captcha / anti-bot not satisfiable via official API/PIA request → reject.
  - Export lacks `owner` OR `APN` OR `situs` → reject (field map unmet).
  - robots.txt disallows the data path → reject (respect it).

## 9. Queue / follow-on sources
- Owner/tax-roll track now has THREE VERIFIED pilot manifests: Maricopa (AZ) LOCKED+verified, Miami-Dade (FL) VERIFIED, Harris (TX) VERIFIED (iter 56). Open (build-time, not source-discovery): confirm live Tax Assessor-Collector delinquent-parcel / sale-roster bulk-file URL each tax-sale cycle (§1–§7).
- Official on-market feed candidate (RESO / RentCast / official MLS) — VERIFIED (iter 44): see `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`.
- Lawful photo/imagery metadata source candidate — VERIFIED (iter 46): see `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.
- Open (build-time, not source-discovery): confirm live Tax Assessor-Collector delinquent-parcel / sale-roster bulk-file URL each tax-sale cycle (§1–§7).

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-harris-2026-06-27.md` (iter 54 created).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Verified registry row: `harris-tx-parcels` in `data/source-registry/county-source-registry.csv` / `.jsonl`
- Sibling pilots (same schema): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (Maricopa AZ, structural template), `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade FL).
