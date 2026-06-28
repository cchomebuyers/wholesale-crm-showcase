# Connector-Ready Pilot Manifest — Official On-Market / Federal Surplus Real-Property Feed (GSA Auctions)

**Pilot feed:** GSA Auctions — the U.S. General Services Administration's official real-property + surplus auction portal. GSA is the seller-of-record (agency = motivated seller) disposing of federal surplus real property via public online auction; not a private individual.
**Discovery memo:** `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G3 drafted GLM iter 126)
**Created:** 2026-06-28 (GLM iter 160)
**Status:** DRAFT PILOT — connector-ready field map + access path documented; pending VERIFIED until GSA bulk/public-record path + auction-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / opening_bid / sale_open_date / sale_close_date / lot# / property_type; APN via assessor join); freshness §4 (`sale_open_date` + `sale_close_date` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings), the HUD HomeStore pilot (FHA-insured REO), and the USDA-RD pilot (rural-development REO) — this is federal **surplus** real-property auctions, broadening the federal-REO/surplus on-market lane to its third connector.
**Lawful basis:** GSA Auctions listings are published on GSA's official auction portal (`gsaauctions.gov`, official `.gov` domain). Federal agency disposing of surplus real property publishes on-market auction listings to the public; owner-of-record is GSA (the disposing agency) — no third-party contact-list purchase, no gated private-owner PII, no MLS-portal scraping, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.

## 1. Official source
- Portal: GSA Auctions — `https://www.gsaauctions.gov` — GSA's official online auction portal for federal surplus real property (and personal property). Parent agency: U.S. General Services Administration.
- Listing class: federal **surplus** real property (real estate declared excess/surplus by federal agencies and conveyed for sale via GSA public auction). Distress signal = federal surplus disposal (motivated-seller-equivalent: agency as seller).
- Provenance: official government disposition portal; no aggregator / people-search origin.

## 2. Access path (public browse + agency public-record/FOIA bulk)
- Public browse (no login to view): auction browse by category (Real Property); per-lot detail pages expose situs address, opening/minimum bid, sale open/close date, lot/sale number, property description.
- Bulk: no documented public API exposed via the portal UI → pair with a GSA agency public-records / FOIA request (5 U.S.C. § 552) for bulk real-property lot inventory (lot-level table). FOIA / agency public-records request is the lawful bulk path; a paid third-party API is not (§6).
- Not allowed: page-by-page hostile crawl, CAPTCHA evasion, bypassing rate limits, scraping Zillow/Redfin/Realtor.com/CoStar or MLS portals, people-search sites.

## 3. Field map (GSA Auctions → CRM)
| CRM field | GSA source field | Notes |
|---|---|---|
| listing_id | lot / sale number | dedupe key |
| situs | property address (street/city/state/zip) | geo key; join to tax-roll pilot on situs/APN |
| list_price | opening / minimum bid | motivation/equity signal (auction reserve) |
| status | auction status (open / closed / sold) | on-market lifecycle |
| sale_open_date | auction open date | new-listing origination / freshness anchor |
| sale_close_date | auction close date | on-market freshness (bid deadline) |
| property_type | property description / category | inventory-context signal |
| apn | (not exposed) | join via situs → county assessor (8 tax-roll pilots) |
| owner_of_record | GSA (agency) | seller-of-record; no private-owner PII from this source |
| (aux) source_pull_ts | connector pull timestamp | per-market freshness |

## 4. Freshness field
- Authoritative anchor: `sale_open_date` (new-listing origination) + `sale_close_date` (bid deadline / lifecycle close).
- Secondary: `status` (auction lifecycle transitions).
- Per-pull: `source_pull_ts`, recorded per retrieval.
- Cadence: confirm at build time before VERIFIED (GSA auctions are per-auction-cycle; record actual refresh cadence in the market row).

## 5. robots.txt / ToS note
- Honor `gsaauctions.gov` robots.txt + GSA site terms-of-use.
- Prefer agency public-records / FOIA bulk or periodic manual retrieval over page-by-page crawl; rate-limit; no CAPTCHA evasion.
- No private-owner contact fields (GSA is seller-of-record). Listing/auction contact fields surfaced by the portal are gated per CRM contacts policy — attribution/internal use only, no republishing raw PII, no mass dialing.

## 6. Rejection criteria (reject GSA Auctions as pilot source if any hold)
- Agency public-record/FOIA bulk path confirmed unavailable AND no other machine-readable export → reject (cannot rely on hostile crawl).
- No freshness field (`sale_open_date` / `sale_close_date` / status timestamp) → reject.
- Missing situs address (no APN join path) → reject.
- ToS prohibits CRM / internal reuse of listing data → reject (cannot gate around a contract prohibition).
- Source provenance traces to Zillow/Redfin/Realtor.com/CoStar or a people-search/aggregator site → reject.
- Requires hostile scraping or CAPTCHA evasion → reject.

## 7. Connector build steps (ordered)
1. File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
2. If bulk is delayed, fall back to periodic manual retrieval of the public auction browse results for the Real Property category (honor robots/ToS, rate-limit, no CAPTCHA evasion) — interim only.
3. Validate field map against §3 on the first batch; if any required field missing → §6 reject.
4. Confirm auction-refresh cadence; record a market row in `data/source-registry`: `{source: gsa_auctions_real_property, bulk_path: foia, cadence, last_fetched, status}`.
5. Join to the 8 county owner/tax-roll pilots on situs → APN for equity/motivation scoring (opening_bid vs. assessed value).
6. Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.
7. Contacts gated; `situs` + `opening_bid` + `status` + `sale_open_date` + `sale_close_date` + `property_type` available to lead scoring.

## 8. Queue / follow-on sources
- On-market RESO/MLS pilot (`data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md`) — VERIFIED CONNECTOR-READY; build-time blockers (per-MLS RESO base URL + OAuth2 + DUA; RentCast 401) tracked in `property-intelligence-status.md`.
- Candidate G1 HUD HomeStore (`data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md`) — DRAFT PILOT; pending FOIA bulk path + nightly-cadence confirmation.
- Candidate G2 USDA-RD (`data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md`) — DRAFT PILOT; pending FOIA bulk path + refresh-cadence confirmation.
- Lawful photo/imagery metadata — DRAFT pilots (Miami-Dade façade / NAIP ortho / Street View metadata); build-time blocker = provision Google Maps Platform key.
- Owner/tax-roll — 8 county pilots VERIFIED (Maricopa AZ LOCKED+VERIFIED; Miami-Dade FL, Clark NV, Harris TX, Santa Clara CA, Los Angeles CA, Cook IL, Hillsborough FL VERIFIED). Discovery lane FULLY mature.

## 9. Files
- This manifest: `data/source-registry/pilot-manifest-onmarket-gsa-auctions-2026-06-28.md` (GLM iter 160).
- Discovery memo: `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md` (Candidate G3).
- Template (active federal-REO/surplus on-market pilot, DRAFT): `data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md`.
- Owner/tax-roll join keys: `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md` (+ 7 county siblings).
