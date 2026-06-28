# Connector-Ready Pilot Manifest — County Tax-Roll (Delinquent-Tax / Tax-Sale) Source

**Pilot county:** Clark County, Nevada — Clark County Treasurer (delinquent real-property tax / tax-sale roster) + Clark County Assessor (parcel / owner / appraisal roll)
**Discovery memo:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
**Created:** 2026-06-27 (GLM iteration 74)
**Status:** DRAFT CONNECTOR-READY (GLM iter 74, 2026-06-27) — fourth-county owner/tax-roll pilot, joining three prior VERIFIED pilots (Maricopa AZ LOCKED+verified iter 22/37; Miami-Dade FL VERIFIED iter 47; Harris TX VERIFIED iter 56). All CODEX-required fields present this loop: official URL (§1, §8), bulk/API/public-record path (§2, §8), field map owner/APN/situs/delinquent_amount/sale_date (§3), freshness field (§4), robots/terms note (§5), rejection criteria (§6). Treasurer delinquent-tax/tax-sale path (§1–§7) and Assessor parcels path (§8) both pending live bulk-file / endpoint URL confirmation at connector build time. Grounded against verified registry row `clark-nv-violations` (FIPS 32003) in `data/source-registry/county-source-registry.jsonl` — note that row is a *violations* layer (City of Las Vegas code enforcement; `has_owner:false`, `has_parcel_id:false`), so a NEW Clark County Assessor parcels registry row must be added/verified before the §8 appraiser path is promoted to VERIFIED.
**Lawful basis:** Nevada Revised Statutes (NRS) Ch. 361 (Property Tax), incl. delinquent-tax / tax-sale provisions (NRS 361.5640 et seq. — publication of delinquent list and sale of property for unpaid taxes) mandates public notice of delinquent property taxes and tax sales; the delinquent-parcel list and sale roster are official government public records (freely redistributable). Owner/parcel roll is a public record under NRS Ch. 239 (Nevada Public Records Act). Official/public sources only; no hostile scraping; no Zillow/Redfin/Realtor/CoStar; no people-search sites. Owner PII gated; B2B files preserved.

## 1. Official source
- Agencies: (a) Clark County Treasurer (NV) — delinquent-tax / tax-sale list; (b) Clark County Assessor — parcel/owner/appraisal roll.
- Official domains (verify exact paths at build time):
  - Clark County: `https://www.clarkcountynv.gov` (.gov — official); Treasurer page pattern: `https://www.clarkcountynv.gov/government/departments/treasury/` (or `.../treasurer/`).
  - Clark County Assessor: `https://www.clarkcountynv.gov/government/elected_officials/assessor/` (official); parcel-search host (e.g. `assessor.parcelstreet.com/clark/` or county GIS) to be confirmed at build time.
- Provenance: government domains; the tax sale is a statutorily-noticed public auction (NRS 361.5640 et seq.), with publication required before sale.

## 2. Access path (bulk / API / public-record)
- Tax-sale / delinquent-tax path (§1–§7): preferred = official downloadable delinquent-parcel list / sale roster (CSV/XLS/XLSX or published notice PDF) posted ahead of the Treasurer's tax sale. Capture the published-file URL at connector build time (URL rotates each sale cycle).
- Fallback: NRS Ch. 239 (Nevada Public Records Act) request to the Clark County Treasurer for the delinquent roll / sale roster.
- Appraiser path (§8): Clark County Assessor public parcel-search / GIS endpoint for situs / APN / geo; `owner` via Assessor tax-roll/mailing export or NRS Ch. 239 request (PII gated). **No verified parcels registry row exists yet** (only `clark-nv-violations`, a violations layer, is verified) — add + verify a `clark-nv-parcels` row before promoting §8.
- Not allowed: page-by-page scraping of the parcel-search or tax-search UIs beyond a manual verify; no automated queries beyond published bulk files / official endpoints; respect robots.txt and any posted rate limits.
- Auth: none expected for the published bulk file or a public endpoint; if a form/EULA is required, capture terms before import.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Notes |
|---|---|---|
| owner | Owner name on delinquent record / Assessor tax-roll assessee | PII — gated; mailing address only for internal outreach |
| APN | Assessor parcel number (APN) | join key to Assessor roll |
| situs | Property situs address (Assessor situs: number + street + city + zip) | geo key |
| delinquent_amount | Taxes due / delinquent amount | distress signal |
| sale_date | Treasurer tax-sale date | freshness anchor |
| (aux) published_date | Delinquent-list / sale-notice publication date | freshness secondary |
| (aux) last_fetched | connector pull timestamp | per-county freshness |

## 4. Freshness field
- Authoritative anchor: `sale_date` (Treasurer tax-sale date).
- Secondary: `published_date` of the delinquent list / sale notice.
- Per-pull: `last_fetched`, recorded per county in the connector manifest.
- Cadence: NV tax sales occur on a recurring statutory schedule (verify cadence per Clark County at build time); re-pull on each new publication.

## 5. robots.txt / ToS note
- Honor `https://www.clarkcountynv.gov/robots.txt` and the Assessor/GIS host robots policy.
- Prefer the published bulk file / official endpoint over any HTML crawling; no concurrent requests.
- If the site posts a data-use / redistribution statement, record it; do not redistribute raw owner PII beyond gated CRM use.
- If a captcha or anti-bot gate blocks the bulk file, STOP and use the NRS Ch. 239 public-records-request path — do not bypass.

## 6. Rejection criteria (reject pilot county and pick an alternate if any hold)
- No machine-readable bulk file (PDF-only roster) AND no NRS Ch. 239 public-records-request path → reject.
- Terms forbid redistribution or commercial use of the delinquent list → reject (or gate to internal-only with legal sign-off).
- Bulk file behind captcha / anti-bot that cannot be satisfied via official API/records request → reject.
- File lacks `owner` OR `APN` OR `situs` OR `delinquent_amount` OR `sale_date` → reject (field map unmet).
- robots.txt disallows the data path → reject (respect it).

## 7. Connector build steps (ordered)
1. Verify official domains + exact tax-sale / delinquent-tax page URL (manual browser, no scraping).
2. Locate the published delinquent-parcel bulk file / sale roster; record URL + file format.
3. Pull once, parse, validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS statement.
5. Seed / update a county row in `data/source-registry/county-source-registry` with `{official_domain, access_method, cadence, last_fetched, robots_txt_status, status}` — add a NEW `clark-nv-parcels` row for the appraiser path (only `clark-nv-violations` currently exists).
6. Owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` available to lead scoring.

## 8. Complementary property-appraiser access path (Clark County Assessor)

The inbox scope allows "tax collector OR property appraiser." The appraiser path is complementary: the Assessor covers the full parcel universe (current owner + appraisal/last-sale freshness), while the Treasurer path (§1–§7) covers the delinquent-amount + sale_date distress subset. Join the two on `APN` (Assessor parcel number).

- Agency: Clark County Assessor (NV) — official property appraisal/assessment authority for Clark County.
- Access path:
  - CANDIDATE (pending verification — no verified parcels registry row exists yet; only `clark-nv-violations`, a violations layer with `has_owner:false` / `has_parcel_id:false`, is verified): locate the official Clark County Assessor public parcel-search / GIS REST endpoint on an official `.gov` host for situs / APN / geo; verify `has_parcel_id` + `has_owner` field availability, then add a `clark-nv-parcels` registry row.
  - `owner` may NOT be exposed by the public parcels layer (per the Clark violations row pattern + sibling-county precedent: Maricopa/Harris public parcels layers are `has_owner:false`). Plan to obtain `owner` via official Assessor tax-roll/mailing export or NRS Ch. 239 request (PII gated) — do NOT assume the public parcels layer carries owner.
  - Fallback: NRS Ch. 239 (Nevada Public Records Act) request to the Assessor for the parcel/owner roll.
  - Not allowed: page-by-page scraping of the Assessor parcel-search UI beyond a manual verify; respect robots.txt and posted rate limits.
- Field map (source → CRM):
  | CRM field | Source field (expected) | Notes |
  |---|---|---|
  | owner | Assessor assessee name / mailing owner | PII — gated |
  | APN | Assessor parcel number | join key (↔ tax-sale roll) |
  | situs | situs number + street + city + zip | geo key |
  | assessed_value | Assessor assessed / appraised value | equity signal |
  | last_sale_date | Last sale date | freshness anchor (ownership change) |
  | last_sale_price | Last sale price | equity signal |
  | (aux) assessment_year | Appraisal / tax year | freshness secondary |
  | (aux) tax_year | Tax year | freshness secondary |
  | (aux) source_pull_ts | connector pull timestamp | per-county freshness |
- Freshness field: `last_sale_date` (ownership-change anchor) + `assessment_year`/`tax_year` (annual revaluation); per-pull `source_pull_ts`.
- robots.txt / ToS note: honor the Clark County / Assessor robots policy; prefer bulk download / official endpoint over HTML crawling; no concurrent requests; record any data-use/redistribution statement; do not redistribute raw owner PII beyond gated CRM use; if captcha/anti-bot blocks the bulk path, STOP and use the NRS Ch. 239 public-records-request path — do not bypass.
- Rejection criteria (for the appraiser path):
  - No machine-readable bulk export AND no NRS Ch. 239 public-records-request path → reject.
  - Terms forbid redistribution or commercial use → reject (or gate to internal-only with legal sign-off).
  - Bulk export behind captcha / anti-bot not satisfiable via official API/records request → reject.
  - Export lacks `owner` OR `APN` OR `situs` → reject (field map unmet).
  - robots.txt disallows the data path → reject (respect it).

## 9. Queue / follow-on sources
- Owner/tax-roll track now has FOUR pilot manifests: Maricopa (AZ) LOCKED+verified, Miami-Dade (FL) VERIFIED, Harris (TX) VERIFIED, Clark (NV) DRAFT (iter 74, this loop). Open (build-time, not source-discovery): confirm live Treasurer delinquent-parcel / sale-roster bulk-file URL each tax-sale cycle (§1–§7); verify Assessor parcels endpoint + add `clark-nv-parcels` registry row to promote §8 to VERIFIED.
- Official on-market feed candidate (RESO / RentCast / official MLS) — VERIFIED (iter 44): see `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`.
- Lawful photo/imagery metadata source candidate — VERIFIED (iter 46): see `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-clark-nv-2026-06-27.md` (iter 74 created).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Verified registry row (violations layer only): `clark-nv-violations` in `data/source-registry/county-source-registry.csv` / `.jsonl` (FIPS 32003).
- Sibling pilots (same schema): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (Maricopa AZ, structural template), `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade FL), `data/source-registry/pilot-manifest-taxroll-harris-2026-06-27.md` (Harris TX).
