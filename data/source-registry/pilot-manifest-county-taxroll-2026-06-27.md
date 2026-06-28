# Connector-Ready Pilot Manifest — County Tax-Roll (Owner / Delinquent-Tax) Source — Miami-Dade County, FL

- Agent: GLM (property-intelligence / source-expansion)
- Iteration: 17 created (DRAFT template) → 47 promoted to second-county VERIFIED pilot (2026-06-28)
- Status: **VERIFIED CONNECTOR-READY (GLM iter 47, 2026-06-28)** — promoted from the superseded DRAFT v0.1 template into the active SECOND owner/tax-roll pilot, joining the LOCKED Maricopa (AZ) pilot (`pilot-manifest-taxroll-maricopa-2026-06-27.md`) to give multi-county owner/tax-roll coverage (AZ + FL). Every CODEX-required field present: official URL §1; bulk/API/public-record path §2; field map owner/APN/situs/delinquent_amount/sale_date §3; freshness field §4; robots/terms note §5; rejection criteria §6. Jurisdiction grounded against verified registry row `miamidade-fl-violations` in `data/source-registry/county-source-registry.jsonl` (official ArcGIS, FL Ch. 119 public-official API, confidence high) and the official `miamidade.gov` domain already reused by the photo/imagery-metadata pilot (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`, VERIFIED iter 46). Remaining work is build-time live-URL/PR fulfillment, not source discovery.
- Discovery memo: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Lawful basis: Florida Statutes Ch. 119 (Public Records) + Florida property appraisal / tax-collection statutes (Ch. 192–197). The tax roll, parcel data, and delinquent-tax / tax-certificate sale records are official government public records — freely inspectable/copyable under Ch. 119. Official/public sources only; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites. Owner PII gated; B2B files preserved.

## 1. Official source
- Pilot county: Miami-Dade County, Florida.
- Two official offices (join on APN/folio):
  - **Property Appraiser** (tax roll / parcel data — owner, APN/folio, situs, assessed value, last sale): official domain `https://www.miamidade.gov/pa/` (.gov — official). FL Ch. 119 public record.
  - **Tax Collector** (delinquent tax / tax-certificate sale / tax-deed sale — delinquent amount, sale_date): official domain `https://www.miamidade.gov/taxcollector/` (.gov — official). FL uses a tax-certificate → tax-deed sale model (annual tax-certificate auction, typically May/June).
- Provenance: government domains; the delinquent-tax list and tax-certificate sale roster are statutorily-noticed public records under FL Ch. 197 and Ch. 119.

## 2. Access path (bulk / API / public-record)
- Property Appraiser (owner + APN + situs + assessment + last-sale):
  - Preferred (per-parcel): official parcel search at `https://www.miamidade.gov/pa/property_search/` → per-folio result exposes owner of record, situs, assessed/market value, last sale date/price, assessment year. Manual/verify use only — not for page-by-page scraping.
  - Preferred (batch): official Property Appraiser open-data / bulk tax-roll download (parcel-level CSV/Shapefile) published on the official `.gov` open-data hub — confirm the current hub URL + dataset at connector build time. Bulk download is the lawful batch path.
  - Fallback: formal Ch. 119 public-records request to the Property Appraiser for the parcel/owner mailing roll (owner PII gated).
  - Verified registry cross-check: `miamidade-fl-violations` row in `data/source-registry/county-source-registry.jsonl` (official ArcGIS FeatureServer, FL Ch. 119 public-official API, confidence high) — reuse for situs/geo/APN join; `has_owner:false` on that violations layer, so owner must come from the appraiser tax-roll/PR path, not the violations layer.
- Tax Collector (delinquent amount + sale_date):
  - Preferred: official published delinquent-tax / tax-certificate-sale list (CSV/XLS/PDF) posted ahead of the annual tax-certificate auction on the Tax Collector's official `.gov` site — capture the published-file URL at build time (URL rotates each sale cycle).
  - Fallback: formal Ch. 119 public-records request to the Tax Collector for the delinquent roll / tax-certificate sale roster.
  - Not allowed: page-by-page scraping of the parcel-search or tax-search UI beyond a manual verify; no automated queries beyond the published bulk file; respect robots.txt and posted rate limits; no captcha bypass (STOP → use the PR-request path).
- Auth: none expected for published bulk files / public parcel search; any API per official key/terms; PR requests fulfilled by the office.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Office | Notes |
|---|---|---|---|
| owner | Owner name on tax roll (assessee) | Property Appraiser | PII — gated; mailing address for internal notice/outreach only |
| APN | Folio / parcel number | Property Appraiser | join key (↔ Tax Collector delinquent roll, ↔ photo-imagery pilot) |
| situs | Property situs address | Property Appraiser | geo key |
| delinquent_amount | Delinquent tax / certificate face amount | Tax Collector | distress signal |
| sale_date | Tax-certificate sale / tax-deed sale date | Tax Collector | freshness anchor |
| (aux) assessed_value | Assessed / just (market) value | Property Appraiser | equity signal |
| (aux) last_sale_date | Last sale date | Property Appraiser | freshness (ownership change) |
| (aux) last_sale_price | Last sale price | Property Appraiser | equity signal |
| (aux) assessment_year | Assessment / roll year | Property Appraiser | freshness secondary |
| (aux) published_date | Delinquent-list publication date | Tax Collector | freshness secondary |
| (aux) last_fetched | connector pull timestamp | connector | per-county freshness |

## 4. Freshness field
- Authoritative anchor (distress subset): `sale_date` (tax-certificate / tax-deed sale date, Tax Collector).
- Authoritative anchor (full roll): `last_sale_date` (ownership change, Property Appraiser) + `assessment_year`/`roll_year` (annual reassessment).
- Secondary: `published_date` of the delinquent list (Tax Collector).
- Per-pull: `last_fetched`, recorded per county in the connector manifest.
- Cadence: annual — tax-certificate auction each spring (FL Ch. 197); tax roll re-pulled each roll year; re-pull on each new publication.

## 5. robots.txt / Terms note
- Honor `https://www.miamidade.gov/robots.txt` and each office's terms of use / data-use statement.
- Prefer published bulk files and/or a Ch. 119 public-records request over any HTML crawling; rate-limit; no concurrent requests.
- Owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` + `assessed_value` available to lead scoring; do not redistribute raw owner PII beyond gated CRM use.
- If a posted data-use/redistribution statement restricts reuse, record it and gate to internal-only (legal sign-off before any external use).
- If a captcha/anti-bot gate blocks the bulk file or parcel search, STOP and use the public-records-request path — do not bypass.

## 6. Rejection criteria (reject pilot county/source or individual record if any hold)
- No machine-readable bulk file (PDF-only roster) AND no Ch. 119 public-records-request path → reject county.
- Terms forbid redistribution or commercial use of the tax roll / delinquent list → reject (or gate to internal-only with legal sign-off).
- Bulk file behind captcha / anti-bot not satisfiable via official API/PR request → reject.
- File lacks `owner` OR `APN` OR `situs` OR `delinquent_amount` OR `sale_date` → reject (field map unmet).
- robots.txt disallows the data path → reject (respect it; fall back to PR request only if that path is permitted).
- Non-official / third-party provenance (traces to an aggregator or people-search site, or re-hosts Zillow/Redfin/Realtor.com/CoStar data) → reject.
- Per-record: missing `APN`/`folio` → reject record; `delinquent_amount` ≤ 0 or non-numeric when delinquency is the signal → drop delinquency flag for that record; `roll_year` older than current roll → exclude unless explicit historical backfill requested.

## 7. Connector build steps (ordered)
1. Verify official domains + exact parcel-search and tax-certificate-sale page URLs (manual browser, no scraping).
2. Locate the Property Appraiser's published bulk tax-roll download; record URL + format + roll year. Locate the Tax Collector's published delinquent-tax / tax-certificate-sale list; record URL + format + sale cycle.
3. Pull once each, parse, validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS / data-use statement for each office.
5. Seed a county row in `data/source-registry/county-source-registry` with `{county_fips:12086, official_domain, access_method, cadence, last_fetched, robots_txt_status, status}`; reconcile against the existing `miamidade-fl-violations` registry row for jurisdiction continuity.
6. Join the two office paths on `APN`/`folio`; owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` + `assessed_value` available to lead scoring.
7. Optionally join the photo/imagery-metadata pilot (`pilot-manifest-photo-imagery-miamidade-2026-06-27.md`) on `APN` to attach a structure-freshness signal.

## 8. Relationship to the Maricopa (AZ) pilot
- This Miami-Dade (FL) pilot is the SECOND owner/tax-roll county. Maricopa (`pilot-manifest-taxroll-maricopa-2026-06-27.md`, LOCKED + VERIFIED iter 22/37) remains the primary pilot. Both follow the identical §1–§7 structure and the same CODEX-required field set; they differ only in jurisdiction/office model:
  - Maricopa AZ: County Treasurer tax-lien sale (annual Feb) + County Assessor ArcGIS parcels (owner not exposed on public parcels layer → PR path).
  - Miami-Dade FL: Tax Collector tax-certificate/tax-deed sale (annual spring, Ch. 197) + Property Appraiser tax roll (Ch. 119 bulk/PR path; violations-layer `has_owner:false` → owner via appraiser roll/PR).
- Multi-county coverage demonstrates the connector manifest is jurisdiction-portable; next expansion can target a third county (e.g., another FL Ch. 119 county or a TX PIA county).

## 9. Queue / follow-on sources
- Owner/tax-roll primary pilot — Maricopa (AZ), LOCKED + VERIFIED (iter 22/37): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`.
- Official on-market feed pilot — VERIFIED (iter 44): `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`.
- Lawful photo/imagery-metadata pilot — Miami-Dade, VERIFIED (iter 46); shares this pilot's `APN` join key and `miamidade.gov` domain: `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`.
- Open (build-time, not source discovery): confirm live Property Appraiser bulk-roll URL + Tax Collector delinquent-list URL each sale cycle; fulfill any Ch. 119 PR requests; obtain RESO/MLS DUA + OAuth2 for the on-market pilot.

## Files
- This manifest: `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (iter 17 DRAFT template; iter 47 promoted to VERIFIED second-county pilot).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
- Primary pilot (Maricopa AZ): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`
- Jurisdiction grounding (verified registry row): `miamidade-fl-violations` in `data/source-registry/county-source-registry.jsonl`
- APN join-key reuse: `data/source-registry/pilot-manifest-photo-imagery-miamidade-2026-06-27.md`
