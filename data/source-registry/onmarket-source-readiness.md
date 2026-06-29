# On-Market Source Readiness

Built: 2026-06-29T10:23:07.838Z

Sources: 5 | verified: 1 | draft: 4 | blocked: 5

## Ranked Sources

### Connector-Ready Pilot Manifest — Official On-Market / New-Listing Feed (RESO Web API via MLS)
- Status: verified (85/100)
- Citation: data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md
- Blockers: Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials.
- Next step: Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials.
- Required fields: listing_id, situs, list_price, status, status_change_ts, list_date, days_on_market, (aux) modification_ts

### Pilot Manifest — Official On-Market Feed: FDIC Real Estate for Sale (REO)
- Status: draft (65/100)
- Citation: data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md
- Official URL: https://www.fdic.gov
- Blockers: Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check).
- Next step: Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check).
- Required fields: situs_address, list_price, property_type, units, status, asset_number, listing_agent, apn

### Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (HUD HomeStore)
- Status: draft (50/100)
- Citation: data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md
- Official URL: https://www.hudhomestore.com
- Blockers: pending VERIFIED until HUD FOIA bulk path + nightly-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`list_date` + `status_change` + `bid_deadline` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (federal REO, not MLS active listings) — broadens the on-market lane.; File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm nightly-refresh cadence (HUD/contractor inventory refresh); record a market row in `data/source-registry`: `{source: hud_homestore, bulk_path: foia, cadence: nightly, last_fetched, status}`.; Stamp VERIFIED once FOIA bulk path + nightly cadence confirmed; until then DRAFT PILOT.
- Next step: File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.)
- Required fields: listing_id, situs, list_price, status, status_change_ts, list_date, bid_deadline, apn

### Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (USDA Rural Development REO Resales)
- Status: draft (50/100)
- Citation: data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md
- Official URL: https://www.resales.usda.gov
- Blockers: pending VERIFIED until USDA-RD bulk/public-record path + listing-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`listing_date` + `status` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings) and the HUD HomeStore pilot (FHA-insured REO) — this is rural-development REO, broadening the federal-REO on-market lane.; File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm listing-refresh cadence; record a market row in `data/source-registry`: `{source: usda_rd_reo, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.
- Next step: File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
- Required fields: listing_id, situs, list_price, status, list_date, property_type, apn, owner_of_record

### Connector-Ready Pilot Manifest — Official On-Market / Federal Surplus Real-Property Feed (GSA Auctions)
- Status: draft (50/100)
- Citation: data/source-registry/pilot-manifest-onmarket-gsa-auctions-2026-06-28.md
- Official URL: https://www.gsaauctions.gov
- Blockers: pending VERIFIED until GSA bulk/public-record path + auction-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / opening_bid / sale_open_date / sale_close_date / lot# / property_type; APN via assessor join); freshness §4 (`sale_open_date` + `sale_close_date` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings), the HUD HomeStore pilot (FHA-insured REO), and the USDA-RD pilot (rural-development REO) — this is federal **surplus** real-property auctions, broadening the federal-REO/surplus on-market lane to its third connector.; File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm auction-refresh cadence; record a market row in `data/source-registry`: `{source: gsa_auctions_real_property, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT.
- Next step: File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.)
- Required fields: listing_id, situs, list_price, status, sale_open_date, sale_close_date, property_type, apn

