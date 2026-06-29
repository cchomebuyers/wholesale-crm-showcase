# On-Market Activation Plan

Built: 2026-06-29T10:32:49.489Z
Readiness input: 2026-06-29T10:23:07.838Z

Sources: 5 | ready to pull: 0 | credentials blocked: 1 | public-records blocked: 3 | verification blocked: 1

## Activation Queue

### Connector-Ready Pilot Manifest — Official On-Market / New-Listing Feed (RESO Web API via MLS)
- Stage: blocked_credentials
- Citation: data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md
- Lawful path: licensed RESO/MLS agreement
- Pull allowed now: no
- Next action: Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials.
- Blockers: Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials.

### Pilot Manifest — Official On-Market Feed: FDIC Real Estate for Sale (REO)
- Stage: blocked_verification
- Citation: data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md
- Lawful path: official government/public-record feed
- Pull allowed now: no
- Next action: Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check).
- Blockers: Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check).

### Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (HUD HomeStore)
- Stage: blocked_public_records
- Citation: data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md
- Lawful path: official government/public-record feed
- Pull allowed now: no
- Next action: File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.)
- Blockers: pending VERIFIED until HUD FOIA bulk path + nightly-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`list_date` + `status_change` + `bid_deadline` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (federal REO, not MLS active listings) — broadens the on-market lane.; File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm nightly-refresh cadence (HUD/contractor inventory refresh); record a market row in `data/source-registry`: `{source: hud_homestore, bulk_path: foia, cadence: nightly, last_fetched, status}`.; Stamp VERIFIED once FOIA bulk path + nightly cadence confirmed; until then DRAFT PILOT.

### Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (USDA Rural Development REO Resales)
- Stage: blocked_public_records
- Citation: data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md
- Lawful path: official government/public-record feed
- Pull allowed now: no
- Next action: File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
- Blockers: pending VERIFIED until USDA-RD bulk/public-record path + listing-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`listing_date` + `status` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings) and the HUD HomeStore pilot (FHA-insured REO) — this is rural-development REO, broadening the federal-REO on-market lane.; File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm listing-refresh cadence; record a market row in `data/source-registry`: `{source: usda_rd_reo, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.

### Connector-Ready Pilot Manifest — Official On-Market / Federal Surplus Real-Property Feed (GSA Auctions)
- Stage: blocked_public_records
- Citation: data/source-registry/pilot-manifest-onmarket-gsa-auctions-2026-06-28.md
- Lawful path: official government/public-record feed
- Pull allowed now: no
- Next action: File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
- Blockers: pending VERIFIED until GSA bulk/public-record path + auction-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / opening_bid / sale_open_date / sale_close_date / lot# / property_type; APN via assessor join); freshness §4 (`sale_open_date` + `sale_close_date` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings), the HUD HomeStore pilot (FHA-insured REO), and the USDA-RD pilot (rural-development REO) — this is federal **surplus** real-property auctions, broadening the federal-REO/surplus on-market lane to its third connector.; File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm auction-refresh cadence; record a market row in `data/source-registry`: `{source: gsa_auctions_real_property, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.

