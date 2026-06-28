# Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (USDA Rural Development REO Resales)

**Pilot feed:** USDA Rural Development (USDA-RD) Single Family Housing REO resales — USDA-RD's official disposition portal for foreclosed rural-development single-family properties. USDA-RD is the seller-of-record (agency = motivated seller), not a private individual.
**Discovery memo:** `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G2 drafted GLM iter 126)
**Created:** 2026-06-28 (GLM iter 137)
**Status:** DRAFT PILOT — connector-ready field map + access path documented; pending VERIFIED until USDA-RD bulk/public-record path + listing-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`listing_date` + `status` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings) and the HUD HomeStore pilot (FHA-insured REO) — this is rural-development REO, broadening the federal-REO on-market lane.
**Lawful basis:** USDA-RD REO resales are published on USDA's official disposition portal (`resales.usda.gov`, official `.usda.gov` domain). Federal agency disposing of real property publishes on-market listings to the public; owner-of-record is USDA-RD — no third-party contact-list purchase, no gated private-owner PII, no MLS-portal scraping, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.

## 1. Official source
- Portal: USDA Rural Development REO — `https://www.resales.usda.gov` — USDA-RD Single Family Housing REO "Browse Available Properties" portal. Parent agency: U.S. Dept. of Agriculture, Rural Development.
- Listing class: rural-development single-family REO (foreclosed USDA-RD guaranteed/direct loans reconveyed to USDA-RD).
- Provenance: official government disposition portal; no aggregator / people-search origin.

## 2. Access path (public browse + agency public-record/FOIA bulk)
- Public browse (no login): "Browse Available Properties" state/county search; per-state listing tables expose situs, list price, listing date, status, property type, agency case number.
- Bulk: no documented public API → pair with a USDA agency public-records / FOIA request (5 U.S.C. § 552) for bulk inventory export (case-level table). FOIA / agency public-records request is the lawful bulk path; a paid third-party API is not (§6).
- Not allowed: page-by-page hostile crawl, CAPTCHA evasion, bypassing rate limits, scraping Zillow/Redfin/Realtor.com/CoStar or MLS portals, people-search sites.

## 3. Field map (USDA-RD REO → CRM)
| CRM field | USDA-RD source field | Notes |
|---|---|---|
| listing_id | agency case number | dedupe key |
| situs | property address (street/city/state/zip) | geo key; join to tax-roll pilot on situs/APN |
| list_price | list price | motivation/equity signal |
| status | status (available / under contract / sold etc.) | on-market lifecycle |
| list_date | listing date | new-listing origination / freshness anchor |
| property_type | property type | inventory-context signal |
| apn | (not exposed) | join via situs → county assessor (6 tax-roll pilots) |
| owner_of_record | USDA-RD (agency) | seller-of-record; no private-owner PII from this source |
| (aux) source_pull_ts | connector pull timestamp | per-market freshness |

## 4. Freshness field
- Authoritative anchor: `listing_date` (new-listing origination).
- Secondary: `status` (lifecycle transitions).
- Per-pull: `source_pull_ts`, recorded per retrieval.
- Cadence: confirm at build time before VERIFIED (USDA-RD postings refresh on a recurring sale cycle; record actual cadence in the market row).

## 5. robots.txt / ToS note
- Honor `resales.usda.gov` robots.txt + USDA site terms-of-use.
- Prefer agency public-records / FOIA bulk or periodic manual retrieval over page-by-page crawl; rate-limit; no CAPTCHA evasion.
- No private-owner contact fields (USDA-RD is seller-of-record). Listing broker/agent contact fields, if surfaced, are gated per CRM contacts policy — attribution/internal use only, no republishing raw PII, no mass agent dialing.

## 6. Rejection criteria (reject USDA-RD REO as pilot source if any hold)
- Agency public-record/FOIA bulk path confirmed unavailable AND no other machine-readable export → reject (cannot rely on hostile crawl).
- No freshness field (`listing_date` / status timestamp) → reject.
- Missing situs address (no APN join path) → reject.
- ToS prohibits CRM / internal reuse of listing data → reject (cannot gate around a contract prohibition).
- Source provenance traces to Zillow/Redfin/Realtor.com/CoStar or a people-search/aggregator site → reject.
- Requires hostile scraping or CAPTCHA evasion → reject.

## 7. Connector build steps (ordered)
1. File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
2. If bulk is delayed, fall back to periodic manual retrieval of the public browse results (honor robots/ToS, rate-limit, no CAPTCHA evasion) — interim only.
3. Validate field map against §3 on the first batch; if any required field missing → §6 reject.
4. Confirm listing-refresh cadence; record a market row in `data/source-registry`: `{source: usda_rd_reo, bulk_path: foia, cadence, last_fetched, status}`.
5. Join to the 6 county owner/tax-roll pilots on situs → APN for equity/motivation scoring (list_price vs. assessed value).
6. Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.
7. Contacts gated; `situs` + `list_price` + `status` + `list_date` + `property_type` available to lead scoring.

## 8. Queue / follow-on sources
- Candidate G3 (GSA Auctions, `gsaauctions.gov`) remains DRAFT in `onmarket-official-gov-feed-candidate-2026-06-27.md` — promote next (federal surplus real-property auctions).
- Candidate G1 HUD HomeStore (`pilot-manifest-onmarket-hud-homestore-2026-06-27.md`) — DRAFT PILOT (iter 128); pending FOIA bulk path + nightly-cadence confirmation.
- On-market RESO/MLS pilot (`pilot-manifest-onmarket-reso-2026-06-27.md`) — VERIFIED CONNECTOR-READY; build-time blockers (per-MLS RESO base URL + OAuth2 + DUA; RentCast 401) tracked in `property-intelligence-status.md`.
- Lawful photo/imagery metadata — DRAFT pilots (Miami-Dade façade / NAIP ortho / Street View metadata); build-time blocker = provision Google Maps Platform key.
- Owner/tax-roll — 6 county pilots (Maricopa AZ LOCKED+VERIFIED; Miami-Dade FL, Clark NV, Harris TX, Santa Clara CA, Los Angeles CA VERIFIED).

## 9. Files
- This manifest: `data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md` (GLM iter 137).
- Discovery memo: `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G2).
- Template (active federal-REO on-market pilot, DRAFT): `data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md`.
- Owner/tax-roll join keys: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (+ 5 county siblings).
