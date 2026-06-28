# Pilot Manifest — Owner / Tax-Roll Connector — Cook County, IL (2026-06-28)

**Status:** DRAFT connector-ready (iteration 141, GLM). New jurisdiction added to the
owner/tax-roll pilot set. Exact Socrata dataset IDs / tax-sale roster URLs flagged
"confirm at onboarding" — see §2, §6. Lawful basis: Illinois public-records law.

**Seed rationale:** `owner-taxroll-candidate-2026-06-27.md` reconciliation (GLM iter 88)
confirms the owner gap this candidate targets is still open and the harvest's top sources
are CA/NY/IL parcel/violation layers **none exposing owner**. Existing tax-roll pilots
(Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA) leave
Illinois uncovered. Cook County (Chicago) is IL's highest-volume delinquent-tax /
scavenger-sale jurisdiction and publishes bulk parcel + assessment data on an official
Socrata open-data portal — a strong, lawful owner/APN/situs source for the IL gap.

---

## §1. Official source / domain

- **Tax-collector layer (delinquent-tax + tax-sale):** Cook County Treasurer
  - Official domain: `https://www.cookcountytreasurer.com/`
  - Statutory sales: **Annual Tax Sale** (current-year delinquencies) and **Scavenger Sale**
    (taxes delinquent 2+ years), governed by the IL Property Tax Code (35 ILCS 200/).
- **Property-appraiser layer (owner / APN / situs / assessed value):** Cook County Assessor
  - Official domain: `https://www.cookcountyassessor.com/`
  - Parcel key = **PIN** (Property Index Number; Cook County's APN equivalent, 10–14 digit).
- **Bulk-data layer (bulk download / API):** Cook County Open Data (Socrata / SODA)
  - Official portal: `https://datacatalog.cookcountyil.gov/`
- **Property-tax portal (lookup, consolidated):** `https://www.cookcountypropertyinfo.com/`

All `.gov` / `.il.us` official government sources. No Zillow / Redfin / Realtor.com / CoStar;
no people-search sites; no hostile scraping.

## §2. Bulk / API / public-record access path

- **Primary (bulk):** Cook County Open Data Socrata portal — `https://datacatalog.cookcountyil.gov/`
  - Datasets of interest (exact 4x4 dataset IDs confirmed at connector build time):
    * Taxpayer / ownership mailing address dataset (owner name + mailing address, by PIN)
    * Assessment roll / residential + commercial characteristics (assessed value, PIN, situs)
    * Parcel boundaries (GIS; PIN + geometry)
  - SODA API pattern (public, no key required for most datasets; CC BY 4.0 license):
    `https://datacatalog.cookcountyil.gov/resource/{dataset_4x4}.json?$where=...&$limit=...`
  - Prefer SODA bulk query + CSV/JSON export over page-by-page crawling. Rate-limit per
    Socrata guidance; honor robots.txt.
- **Secondary (tax-sale roster):** Cook County Treasurer tax-sale pages publish the
  delinquent-property list / sale results before each Annual Tax Sale and Scavenger Sale.
  Confirm exact roster URL + format (CSV/XLS/PDF) at onboarding; prefer a posted bulk file
  over HTML scraping. If only a search widget is exposed, file an IL FOIA request
  (5 ILCS 140) for the delinquent roster as a flat file.
- **Tertiary (recorded docs / last sale):** Cook County Clerk (Recorder of Deeds division) —
  `https://cookcountyclerkil.gov/` — for recorded deeds (last sale date / grantee). Public
  records; bulk via FOIA where no bulk endpoint exists.

## §3. Field map → CODEX-required fields

| Required field        | Source layer        | Field / note                                                    |
|-----------------------|---------------------|-----------------------------------------------------------------|
| owner                 | Assessor / Open Data| Taxpayer/ownership mailing dataset — owner name (+ mailing, gated)|
| APN                   | All layers          | **PIN** (Property Index Number); join key across all layers     |
| situs                 | Assessor / Open Data| Property (situs) address; derivable from PIN + parcel dataset   |
| delinquent amount     | Treasurer           | Taxes owed + interest/penalties on the delinquent roster        |
| sale_date             | Treasurer           | Annual Tax Sale date / Scavenger Sale date (authoritative anchor)|
| assessed_value        | Assessor            | Assessed + market value (motivation/equity signal)              |
| last_sale_date        | Clerk (Recorder)    | Recording date of last deed (motivation/equity signal)          |

Owner PII (mailing address) is **gated** within the CRM outreach workflow; never republished
to unscoped surfaces. B2B files untouched.

## §4. Freshness field

- **Authoritative anchor (tax-sale layer):** `sale_date` (Annual / Scavenger Sale date) +
  `published_date` (roster posting date).
- **Bulk/roll layer:** `tax_year` (e.g., 2024 taxes, sold 2025), `assessment_year`
  (triennial reassessment in Cook County), `recording_date` (last deed).
- **Connector record:** `source_pull_ts` (ISO 8601, per pull), `source_domain`,
  `source_layer`. Store per-county in the connector manifest.
- Tax-sale cadence: Annual Tax Sale once/year (typically late calendar year); Scavenger Sale
  periodic. Re-pull roster each sale cycle; re-pull roll annually.

## §5. robots.txt / Terms-of-Use note

- Respect `robots.txt` on all `cookcountytreasurer.com`, `cookcountyassessor.com`,
  `datacatalog.cookcountyil.gov`, `cookcountyclerkil.gov` endpoints.
- Socrata open-data portal: public SODA API; datasets generally licensed CC BY 4.0
  (confirm per-dataset license at onboarding; attribute "Cook County").
- Prefer **bulk download / SODA API / FOIA request** over HTML crawl; rate-limit; cache with
  `source_pull_ts`. Do not hammer the property-search widgets.
- Tax-sale rosters are statutorily-published public records (35 ILCS 200/) — lawful to ingest;
  observe any posted data-use terms on the Treasurer site.

## §6. Rejection criteria (for this or any alternate county)

Reject the source / pick an alternate county if ANY of:
- Exact dataset IDs / roster URL cannot be confirmed as an official `.gov` / `.il.us` source,
  or the only access is a people-search/aggregator re-host.
- No freshness field available (no `tax_year` / `sale_date` / `published_date` / pull ts).
- Owner name is gated behind a **paid, non-public** API (commercial reseller); public-record
  FOIA-only is acceptable, paid-only is not.
- Access requires hostile scraping (captcha-gated PDF-only roster with no FOIA alternative,
  or terms forbidding automated/CRM reuse).
- APN (PIN) or situs address is not exposed in the dataset → cannot join to existing harvest.
- Source re-hosts Zillow / Redfin / Realtor.com / CoStar data.

## §7. Connector build steps (high level)

1. Confirm exact Socrata 4x4 dataset IDs (ownership/taxpayer, assessment roll, parcels) via
   `https://datacatalog.cookcountyil.gov/` catalog search; record per-dataset license.
2. Confirm Treasurer Annual Tax Sale + Scavenger Sale roster URL + format; record `sale_date`
   and `published_date` per cycle.
3. Stand up SODA pull (owner mailing gated; PIN + situs + assessed_value + tax_year open).
4. Join to existing harvest on PIN (Cook County) and to Treasurer delinquent roster on PIN.
5. Stamp every row `source_pull_ts` + `source_domain` + `source_layer`.
6. Re-pull roster each tax-sale cycle; re-pull roll annually (triennial reassessment noted).

## §8. Compliance

- Official/public sources only (`.gov` / `.il.us`). Illinois FOIA (5 ILCS 140) + Property Tax
  Code (35 ILCS 200/) lawful basis.
- No scraping of Zillow / Redfin / Realtor.com / CoStar or people-search sites.
- Owner / taxpayer PII gated; B2B files preserved; no hostile scraping.

## §9. Queue

- Owner/tax-roll lane: this manifest (Cook IL, DRAFT) + LOCKED/verified pilots
  (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Los Angeles CA, Santa Clara CA).
- On-market lane (carried, not this loop): RESO Web API via MLS — resolve DUA/OAuth2 +
  feed-URL/token blockers flagged in `property-intelligence-status.md`; RentCast API-key
  (401 auth) resolution. (See `pilot-manifest-onmarket-reso-2026-06-27.md`.)
- Photo/imagery lane (carried, not this loop): county appraiser parcel-photo metadata +
  NAIP + Street-View-metadata. (See `pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.)

**Files inspected this loop:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
(read in full — confirmed candidate promoted; Cook IL fills the IL owner gap left by existing
pilots). `data/source-registry/property-intelligence-status.md` intentionally skipped this
loop to stay bounded (queued for reconciliation next loop).
