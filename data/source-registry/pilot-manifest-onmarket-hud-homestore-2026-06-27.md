# Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (HUD HomeStore)

**Pilot feed:** HUD HomeStore — HUD's official REO disposition portal for 1–4 unit residential (foreclosed FHA-insured properties reconveyed to HUD). HUD is the seller-of-record (agency = motivated seller), not a private individual.
**Discovery memo:** `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G1 drafted GLM iter 126)
**Created:** 2026-06-28 (GLM iter 128)
**Status:** DRAFT PILOT — connector-ready field map + access path documented; pending VERIFIED until HUD FOIA bulk path + nightly-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`list_date` + `status_change` + `bid_deadline` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (federal REO, not MLS active listings) — broadens the on-market lane.
**Lawful basis:** HUD HomeStore is HUD's official REO disposition portal (contractor-operated on HUD's behalf) on an official government-linked domain. Federal agency disposing of real property publishes on-market listings to the public; owner-of-record is HUD — no third-party contact-list purchase, no gated private-owner PII, no MLS-portal scraping, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.

## 1. Official source
- Portal: HUD HomeStore — `https://www.hudhomestore.com` — HUD's official REO disposition portal (contractor-operated on HUD's behalf). Parent agency: U.S. Dept. of Housing and Urban Development.
- Listing class: 1–4 unit residential REO (foreclosed FHA-insured properties reconveyed to HUD).
- Provenance: official government disposition portal; no aggregator / people-search origin.

## 2. Access path (public browse + FOIA bulk)
- Public browse (no login): search by state/county/price/status/property type; per-listing detail pages expose situs, list price, list date, HUD case number, status, bid deadline, beds/baths, FHA-insurability flag.
- Bulk: not offered via UI/API → pair with a HUD FOIA request (5 U.S.C. § 552) for bulk inventory export (case-level table). FOIA is the lawful bulk path; a paid third-party API is not (§6).
- Not allowed: page-by-page hostile crawl, CAPTCHA evasion, bypassing rate limits, scraping Zillow/Redfin/Realtor.com/CoStar or MLS portals, people-search sites.

## 3. Field map (HUD HomeStore → CRM)
| CRM field | HUD source field | Notes |
|---|---|---|
| listing_id | HUD case number | dedupe key |
| situs | property address (street/city/state/zip) | geo key; join to tax-roll pilot on situs/APN |
| list_price | list price / bid floor | motivation/equity signal |
| status | status (IN / PIE / UC etc.) | on-market lifecycle |
| status_change_ts | status transition (derived) | on-market freshness |
| list_date | list date | new-listing origination |
| bid_deadline | bid deadline | actionability window |
| apn | (not exposed) | join via situs → county assessor (6 tax-roll pilots) |
| (aux) fha_insurability | FHA-insurability flag | financing-context signal |
| (aux) source_pull_ts | connector pull timestamp | per-market freshness |

## 4. Freshness field
- Authoritative anchor: `list_date` (new-listing origination).
- Secondary: `status_change` (status transitions) + `bid_deadline` (actionability window).
- Per-pull: `source_pull_ts`, recorded per retrieval.
- Cadence: nightly (HUD/contractor refreshes inventory nightly) — confirm at build time before VERIFIED.

## 5. robots.txt / ToS note
- Honor `hudhomestore.com` robots.txt + HUD site terms-of-use.
- Prefer FOIA bulk or periodic manual retrieval over page-by-page crawl; rate-limit; no CAPTCHA evasion.
- Listing broker/agent contact fields (where shown on detail pages) are gated per CRM contacts policy — attribution/internal use only, no republishing raw PII to unscoped surfaces, no mass agent dialing.
- HUD is the seller-of-record (agency) — no private-owner PII harvested from this source.

## 6. Rejection criteria (reject HUD HomeStore as pilot source if any hold)
- FOIA bulk path confirmed unavailable AND no other machine-readable export → reject (cannot rely on hostile crawl).
- No freshness field (`list_date` / status timestamp / `bid_deadline`) → reject.
- Missing situs address (no APN join path) → reject.
- ToS prohibits CRM / internal reuse of listing data → reject (cannot gate around a contract prohibition).
- Source provenance traces to Zillow/Redfin/Realtor.com/CoStar or a people-search/aggregator site → reject.
- Requires hostile scraping or CAPTCHA evasion → reject.

## 7. Connector build steps (ordered)
1. File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.)
2. If FOIA bulk is delayed, fall back to periodic manual retrieval of the public browse results (honor robots/ToS, rate-limit, no CAPTCHA evasion) — interim only.
3. Validate field map against §3 on the first batch; if any required field missing → §6 reject.
4. Confirm nightly-refresh cadence (HUD/contractor inventory refresh); record a market row in `data/source-registry`: `{source: hud_homestore, bulk_path: foia, cadence: nightly, last_fetched, status}`.
5. Join to the 6 county owner/tax-roll pilots on situs → APN for equity/motivation scoring (list_price vs. assessed value).
6. Stamp VERIFIED once FOIA bulk path + nightly cadence confirmed; until then DRAFT PILOT.
7. Contacts gated; `situs` + `list_price` + `status` + `list_date` + `bid_deadline` available to lead scoring.

## 8. Queue / follow-on sources
- Candidate G2 (USDA-RD resales, `resales.usda.gov`) and G3 (GSA Auctions, `gsaauctions.gov`) remain DRAFT in `onmarket-official-gov-feed-candidate-2026-06-27.md` — promote after G1 HUD pilot is VERIFIED.
- On-market RESO/MLS pilot (`pilot-manifest-onmarket-reso-2026-06-27.md`) — VERIFIED CONNECTOR-READY; build-time blockers (per-MLS RESO base URL + OAuth2 + DUA; RentCast 401) tracked in `property-intelligence-status.md`.
- Lawful photo/imagery metadata — DRAFT pilots (Miami-Dade façade / NAIP ortho / Street View metadata); build-time blocker = provision Google Maps Platform key.
- Owner/tax-roll — 6 county pilots (Maricopa AZ LOCKED+VERIFIED; Miami-Dade FL, Clark NV, Harris TX, Santa Clara CA, Los Angeles CA VERIFIED).

## 9. Files
- This manifest: `data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md` (GLM iter 128).
- Discovery memo: `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G1).
- Template (active on-market pilot, VERIFIED): `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`.
- Owner/tax-roll join keys: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (+ 5 county siblings).
