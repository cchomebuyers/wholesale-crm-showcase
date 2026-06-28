# Connector-Ready Pilot Manifest — County Tax-Roll (Owner / Delinquent-Tax) Source — Hillsborough County, FL

- Agent: GLM (property-intelligence / source-expansion)
- Iteration: 152 created (2026-06-28) — promoted from candidate `owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` (GLM iter 103)
- Status: **CONNECTOR-READY (GLM iter 152, 2026-06-28)** — eighth owner/tax-roll pilot; closes the residual owner-population gap flagged in `owner-taxroll-candidate-2026-06-27.md` (Maricopa public parcels layer `has_owner:false`; HCPA bulk roll directly exposes owner name + mailing address under FL Ch. 119). Every CODEX-required field present: official URL §1; bulk/API/public-record path §2; field map owner/APN/situs/delinquent_amount/sale_date §3; freshness field §4; robots/terms note §5; rejection criteria §6. Remaining work is build-time live-URL/PR fulfillment, not source discovery.
- Discovery memo: `data/source-registry/owner-taxroll-candidate-hillsborough-fl-2026-06-27.md`
- Lawful basis: Florida Statutes Ch. 119 (Public Records) + Ch. 192–197 (appraisal / tax-collection). Parcel/ownership tax-roll data and delinquent-tax / tax-certificate sale records are official government public records — freely inspectable/copyable under Ch. 119; tax-certificate/tax-deed sale notices are statutorily published under Ch. 197. Official/public sources only; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites. Owner PII gated; B2B files preserved.

## 1. Official source
- Pilot county: Hillsborough County, Florida (FIPS 12057).
- Two official offices (join on STRAP/APN):
  - **Property Appraiser** (tax roll / parcel data — owner, APN/STRAP, situs, assessed value, last sale): Hillsborough County Property Appraiser (HCPA) — official domain `https://hcpafl.org` (constitutional county office; FL Ch. 119 public record). HCPA publishes a public data-downloads / data-services page (parcel/STRAP extract).
  - **Tax Collector** (delinquent tax / tax-certificate sale / tax-deed sale — delinquent amount, sale_date): Hillsborough County Tax Collector — official domain `https://hilltax.com` (constitutional county office; FL Ch. 197). FL uses a tax-certificate → tax-deed sale model (annual tax-certificate auction, typically May/June).
- Provenance: official government domains; the delinquent-tax list and tax-certificate sale roster are statutorily-noticed public records under FL Ch. 197 and Ch. 119. Exact bulk-download endpoint URLs to be confirmed at connector build time (sale-cycle rotation + HCPA page reorganization possible) — recorded as `last_fetched` per pull.

## 2. Access path (bulk / API / public-record)
- Property Appraiser (owner + APN/STRAP + situs + assessment + last-sale):
  - Preferred (batch): HCPA public data-downloads / data-services page → annual/weekly tax-roll extract (parcel-level CSV / Access / annual roll file). Bulk download is the lawful batch path; confirm the current download URL + format + roll year at connector build time.
  - Preferred (per-parcel, verify only): HCPA parcel/STRAP search → per-parcel result exposes owner of record, situs, assessed/market value, last sale date/price, assessment year. Manual/verify use only — not for page-by-page scraping.
  - Fallback: formal Ch. 119 public-records request to HCPA for the parcel/owner mailing roll (owner PII gated).
- Tax Collector (delinquent amount + sale_date):
  - Preferred: official published delinquent-tax / tax-certificate-sale list (CSV/XLS/PDF) posted ahead of the annual tax-certificate auction on `hilltax.com` — capture the published-file URL at build time (URL rotates each sale cycle).
  - Fallback: formal Ch. 119 public-records request to the Tax Collector for the delinquent roll / tax-certificate sale roster.
  - Not allowed: page-by-page scraping of the parcel-search or tax-search UI beyond a manual verify; no automated queries beyond the published bulk file; respect robots.txt and posted rate limits; no captcha bypass (STOP → use the PR-request path).
- Auth: none expected for published bulk files / public parcel search; any API per official key/terms; PR requests fulfilled by the office.

## 3. Field map (source → CRM)
| CRM field | Source field (expected) | Office | Notes |
|---|---|---|---|
| owner | Owner name on tax roll (assessee) | Property Appraiser | PII — gated; mailing address for internal notice/outreach only |
| APN | STRAP / parcel number | Property Appraiser | join key (↔ Tax Collector delinquent roll, ↔ photo-imagery pilots) |
| situs | Property situs address | Property Appraiser | geo key |
| delinquent_amount | Delinquent tax / certificate face amount | Tax Collector | distress signal |
| sale_date | Tax-certificate sale / tax-deed sale date | Tax Collector | freshness anchor (distress subset) |
| (aux) assessed_value | Assessed / just (market) value | Property Appraiser | equity signal |
| (aux) last_sale_date | Last sale date | Property Appraiser | freshness (ownership change) |
| (aux) last_sale_price | Last sale price | Property Appraiser | equity signal |
| (aux) legal_description | Legal description | Property Appraiser | parcel context |
| (aux) roll_year / assessment_year | Tax / assessment roll year | Property Appraiser | freshness secondary |
| (aux) cert_date | Roll certification date | Property Appraiser | authoritative freshness anchor (owner roll) |
| (aux) case_number | Tax-certificate / tax-deed case number | Tax Collector | dedupe / case tracking |
| (aux) published_date | Delinquent-list publication date | Tax Collector | freshness secondary |
| (aux) last_fetched | connector pull timestamp | connector | per-county freshness |

## 4. Freshness field
- Authoritative anchor (owner roll): `cert_date` (roll certification) + `roll_year`/`assessment_year` (annual reassessment), Property Appraiser.
- Authoritative anchor (distress subset): `sale_date` (tax-certificate / tax-deed sale date, Tax Collector).
- Secondary: `published_date` of the delinquent list; `last_sale_date` (ownership change).
- Per-pull: `last_fetched`, recorded per county in the connector manifest.
- Cadence: annual — tax-certificate auction each spring (FL Ch. 197); tax roll re-pulled each roll year; re-pull on each new publication.

## 5. robots.txt / Terms note
- Honor `https://hcpafl.org/robots.txt` and `https://hilltax.com/robots.txt` plus each office's posted terms of use / data-use statement.
- Prefer published bulk files and/or a Ch. 119 public-records request over any HTML crawling; rate-limit; no concurrent requests.
- Owner PII stays gated; `situs` + `APN`/`STRAP` + `delinquent_amount` + `sale_date` + `assessed_value` available to lead scoring; do not redistribute raw owner PII beyond gated CRM use.
- If a posted data-use/redistribution statement restricts reuse, record it and gate to internal-only (legal sign-off before any external use).
- If a captcha/anti-bot gate blocks the bulk file or parcel search, STOP and use the public-records-request path — do not bypass.

## 6. Rejection criteria (reject pilot county/source or individual record if any hold)
- No machine-readable bulk file (PDF-only roster) AND no Ch. 119 public-records-request path → reject county.
- Terms forbid redistribution or commercial use of the tax roll / delinquent list → reject (or gate to internal-only with legal sign-off).
- Bulk file behind captcha / anti-bot not satisfiable via official API/PR request → reject.
- File lacks `owner` OR `APN`/`STRAP` OR `situs` OR `delinquent_amount` OR `sale_date` → reject (field map unmet).
- robots.txt disallows the data path → reject (respect it; fall back to PR request only if that path is permitted).
- Non-official / third-party provenance (traces to an aggregator or people-search site, or re-hosts Zillow/Redfin/Realtor.com/CoStar data) → reject.
- Per-record: missing `APN`/`STRAP` → reject record; `delinquent_amount` ≤ 0 or non-numeric when delinquency is the signal → drop delinquency flag for that record; `roll_year` older than current roll → exclude unless explicit historical backfill requested.

## 7. Connector build steps (ordered)
1. Verify official domains + exact HCPA data-downloads page URL and Tax Collector tax-certificate-sale page URL (manual browser, no scraping).
2. Locate HCPA's published bulk tax-roll download; record URL + format + roll year + `cert_date`. Locate the Tax Collector's published delinquent-tax / tax-certificate-sale list; record URL + format + sale cycle.
3. Pull once each, parse, validate field map against §3; if any required field missing → §6 reject.
4. Record robots.txt status + any ToS / data-use statement for each office.
5. Seed a county row in `data/source-registry/county-source-registry` with `{county_fips:12057, official_domain, access_method, cadence, last_fetched, robots_txt_status, status}`; reconcile against any existing Hillsborough registry rows for jurisdiction continuity.
6. Join the two office paths on `APN`/`STRAP`; owner PII stays gated; `situs` + `APN` + `delinquent_amount` + `sale_date` + `assessed_value` available to lead scoring.
7. Optionally join the photo/imagery-metadata pilots on `APN`/`STRAP` to attach a structure-freshness signal.

## 8. Relationship to the other owner/tax-roll pilots
- This Hillsborough (FL) pilot is the EIGHTH owner/tax-roll county, closing the residual owner-population gap (HCPA bulk roll exposes owner name + mailing under Ch. 119 without a per-record PR request — unlike Maricopa's public parcels layer). It follows the identical §1–§7 structure and CODEX-required field set as the Miami-Dade (FL) pilot; both share the FL Ch. 119 / Ch. 197 framework and the tax-certificate → tax-deed sale model.
- Existing verified owner/tax-roll pilots on disk (7): Maricopa AZ (`pilot-manifest-taxroll-maricopa-2026-06-27.md`, LOCKED), Miami-Dade FL (`pilot-manifest-county-taxroll-2026-06-27.md`), Clark NV, Harris TX, Los Angeles CA, Santa Clara CA, Cook IL.
- Jurisdiction-portability demonstrated across AZ/FL/NV/TX/CA/IL; next expansion can target a ninth county if a new owner-population gap is identified (Palm Beach / Orange / Lee FL, or a TX PIA county, as fallbacks).

## 9. Queue / follow-on sources
- Official on-market feed pilot — RESO Web API via MLS (`pilot-manifest-onmarket-reso-2026-06-27.md`); HUD HomeStore + USDA RD on-market pilots scaffolded. Open: RESO/MLS DUA + OAuth2 + API-key resolution (no MLS-portal scraping).
- Lawful photo/imagery-metadata pilots — Miami-Dade, Hillsborough FL, NAIP, Street View metadata (metadata-only; no governed image bytes).
- Open (build-time, not source discovery): confirm live HCPA bulk-roll URL + Tax Collector delinquent-list URL each sale cycle; fulfill any Ch. 119 PR requests.

## Files
- This manifest: `data/source-registry/pilot-manifest-taxroll-hillsborough-fl-2026-06-28.md` (iter 152).
- Discovery memo: `data/source-registry/owner-taxroll-candidate-hillsborough-fl-2026-06-27.md` (iter 103).
- Structural template (FL Ch. 119/197): `data/source-registry/pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade).
- Reconciliation source: `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (iter-88 status reconciliation confirms primary pilot-manifest goal ACHIEVED; Maricopa `has_owner:false` motivates this owner-bearing candidate).
- APN/STRAP join-key reuse: `data/source-registry/pilot-manifest-photo-imagery-hillsborough-fl-2026-06-27.md`.

## Compliance
Official/public FL sources only; owner PII gated; B2B files preserved; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites.
