# On-Market Activation Packets

Built: 2026-06-29T10:40:55.062Z
Activation plan input: 2026-06-29T10:32:49.489Z

Packets: 5 | credential: 1 | public-record: 3 | verification: 1 | pull checklist: 0

## Connector-Ready Pilot Manifest — Official On-Market / New-Listing Feed (RESO Web API via MLS)
- Request type: credential_scope
- Citation: data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md
- Stage: blocked_credentials
- Recipient: MLS data-access / broker compliance contact
- Subject: Confirm RESO Web API access scope and OAuth2 credentials for internal deal analysis
- Legal basis: licensed RESO/MLS agreement
- Next registry row: `{"source":"reso","access_status":"blocked_pending_response","lawful_path":"licensed RESO/MLS agreement","credential_or_bulk_path":"mls_dua_oauth2","cadence":"daily","last_fetched":null,"terms_recorded":false,"contact_fields_gated":true,"citation":"data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md"}`
- Do not do: do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites; do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions; do not expose owner, agent, phone, or email contacts without the compliance gate

```text
Please confirm whether our permitted access scope allows internal CRM/deal-analysis use of active listing data through the RESO Web API.
Needed fields: listing_id, situs, list_price, status, status_change_ts, list_date, days_on_market, (aux) modification_ts, (aux) listing_member, (aux) listing_office, (aux) source_pull_ts.
Needed freshness anchors: Authoritative anchor: `ModificationTimestamp` (RESO standard) — record-level last-modified.; Secondary: `StatusChangeTimestamp` (status transitions) + `ListingContractDate` (new-listing origination).; Per-pull: `source_pull_ts`, recorded per MLS market in the connector manifest.; Cadence: incremental pulls keyed off `ModificationTimestamp` (delta sync); recommended daily for DOM-fresh lead scoring in pilot markets..
Please provide or authorize the RESO base URL, OAuth2 client-credentials flow, rate limits, attribution rules, and any field-level restrictions.
Current blocker: Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials..
Use case basis: licensed RESO/MLS agreement.
```

## Pilot Manifest — Official On-Market Feed: FDIC Real Estate for Sale (REO)
- Request type: source_verification
- Citation: data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md
- Stage: blocked_verification
- Recipient: FDIC source owner or public web contact
- Subject: Verify official FDIC listing path, fields, and freshness cadence
- Legal basis: official government/public-record feed
- Next registry row: `{"source":"fdic_reo","access_status":"blocked_pending_response","lawful_path":"official government/public-record feed","credential_or_bulk_path":"official_path_verification","cadence":"daily","last_fetched":null,"terms_recorded":false,"contact_fields_gated":true,"citation":"data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md"}`
- Do not do: do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites; do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions; do not expose owner, agent, phone, or email contacts without the compliance gate

```text
Please confirm the current official listing/search URL, machine-readable export options, field availability, and refresh cadence.
Fields to verify: situs_address, list_price, property_type, units, status, asset_number, listing_agent, apn.
Freshness anchors to verify: **Authoritative anchor:** `list_date` (date the property was posted for sale).; **Secondary:** `status_change` (e.g., price change / under-contract / sold date) + `source_pull_ts` (per-retrieval timestamp recorded by the connector).; **Re-poll cadence:** daily (FDIC listings refresh on a rolling basis; status changes time-sensitive for wholesale lead scoring)..
Current blocker: Confirm live FDIC "Real Estate for Sale" listing-search subpath under `fdic.gov` (consumer-resources reorg check)..
Use case basis: official government/public-record feed.
```

## Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (HUD HomeStore)
- Request type: public_record_bulk
- Citation: data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md
- Stage: blocked_public_records
- Recipient: HUD public-records / FOIA office
- Subject: Public-record bulk inventory request for HUD on-market real property
- Legal basis: official government/public-record feed
- Next registry row: `{"source":"hud_homestore","access_status":"blocked_pending_response","lawful_path":"official government/public-record feed","credential_or_bulk_path":"agency_public_record_or_foia_bulk","cadence":"nightly","last_fetched":null,"terms_recorded":false,"contact_fields_gated":true,"citation":"data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md"}`
- Do not do: do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites; do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions; do not expose owner, agent, phone, or email contacts without the compliance gate

```text
I am requesting a bulk public-record extract for active or recently changed real-property sale/auction/REO inventory.
Requested fields: listing_id, situs, list_price, status, status_change_ts, list_date, bid_deadline, apn, (aux) fha_insurability, (aux) source_pull_ts.
Requested freshness/cadence metadata: Authoritative anchor: `list_date` (new-listing origination).; Secondary: `status_change` (status transitions) + `bid_deadline` (actionability window).; Per-pull: `source_pull_ts`, recorded per retrieval.; Cadence: nightly (HUD/contractor refreshes inventory nightly) — confirm at build time before VERIFIED..
Preferred delivery: CSV, JSON, fixed-width, API, or recurring email/export. A small sample file is enough to validate the connector first.
Current blocker: pending VERIFIED until HUD FOIA bulk path + nightly-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`list_date` + `status_change` + `bid_deadline` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (federal REO, not MLS active listings) — broadens the on-market lane.; File HUD FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, list_date, status, bid_deadline); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm nightly-refresh cadence (HUD/contractor inventory refresh); record a market row in `data/source-registry`: `{source: hud_homestore, bulk_path: foia, cadence: nightly, last_fetched, status}`.; Stamp VERIFIED once FOIA bulk path + nightly cadence confirmed; until then DRAFT PILOT..
Use case basis: official government/public-record feed.
```

## Connector-Ready Pilot Manifest — Official On-Market / Federal REO Feed (USDA Rural Development REO Resales)
- Request type: public_record_bulk
- Citation: data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md
- Stage: blocked_public_records
- Recipient: USDA Rural Development public-records / FOIA office
- Subject: Public-record bulk inventory request for USDA Rural Development on-market real property
- Legal basis: official government/public-record feed
- Next registry row: `{"source":"usda_rd","access_status":"blocked_pending_response","lawful_path":"official government/public-record feed","credential_or_bulk_path":"agency_public_record_or_foia_bulk","cadence":"recurring_unconfirmed","last_fetched":null,"terms_recorded":false,"contact_fields_gated":true,"citation":"data/source-registry/pilot-manifest-onmarket-usda-rd-2026-06-27.md"}`
- Do not do: do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites; do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions; do not expose owner, agent, phone, or email contacts without the compliance gate

```text
I am requesting a bulk public-record extract for active or recently changed real-property sale/auction/REO inventory.
Requested fields: listing_id, situs, list_price, status, list_date, property_type, apn, owner_of_record, (aux) source_pull_ts.
Requested freshness/cadence metadata: Authoritative anchor: `listing_date` (new-listing origination).; Secondary: `status` (lifecycle transitions).; Per-pull: `source_pull_ts`, recorded per retrieval.; Cadence: confirm at build time before VERIFIED (USDA-RD postings refresh on a recurring sale cycle; record actual cadence in the market row)..
Preferred delivery: CSV, JSON, fixed-width, API, or recurring email/export. A small sample file is enough to validate the connector first.
Current blocker: pending VERIFIED until USDA-RD bulk/public-record path + listing-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / list_price / list_date / status / case#; APN via assessor join); freshness §4 (`listing_date` + `status` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings) and the HUD HomeStore pilot (FHA-insured REO) — this is rural-development REO, broadening the federal-REO on-market lane.; File USDA agency public-records / FOIA request for bulk REO inventory (case-level table: case#, situs, list_price, listing_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm listing-refresh cadence; record a market row in `data/source-registry`: `{source: usda_rd_reo, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT..
Use case basis: official government/public-record feed.
```

## Connector-Ready Pilot Manifest — Official On-Market / Federal Surplus Real-Property Feed (GSA Auctions)
- Request type: public_record_bulk
- Citation: data/source-registry/pilot-manifest-onmarket-gsa-auctions-2026-06-28.md
- Stage: blocked_public_records
- Recipient: GSA public-records / FOIA office
- Subject: Public-record bulk inventory request for GSA on-market real property
- Legal basis: official government/public-record feed
- Next registry row: `{"source":"gsa_auctions","access_status":"blocked_pending_response","lawful_path":"official government/public-record feed","credential_or_bulk_path":"agency_public_record_or_foia_bulk","cadence":"unconfirmed","last_fetched":null,"terms_recorded":false,"contact_fields_gated":true,"citation":"data/source-registry/pilot-manifest-onmarket-gsa-auctions-2026-06-28.md"}`
- Do not do: do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites; do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions; do not expose owner, agent, phone, or email contacts without the compliance gate

```text
I am requesting a bulk public-record extract for active or recently changed real-property sale/auction/REO inventory.
Requested fields: listing_id, situs, list_price, status, sale_open_date, sale_close_date, property_type, apn, owner_of_record, (aux) source_pull_ts.
Requested freshness/cadence metadata: Authoritative anchor: `sale_open_date` (new-listing origination) + `sale_close_date` (bid deadline / lifecycle close).; Secondary: `status` (auction lifecycle transitions).; Per-pull: `source_pull_ts`, recorded per retrieval.; Cadence: confirm at build time before VERIFIED (GSA auctions are per-auction-cycle; record actual refresh cadence in the market row)..
Preferred delivery: CSV, JSON, fixed-width, API, or recurring email/export. A small sample file is enough to validate the connector first.
Current blocker: pending VERIFIED until GSA bulk/public-record path + auction-refresh cadence confirmed (§7). All CODEX-required fields present: official source §1; access path §2 (public browse + agency public-record/FOIA bulk); field map §3 (situs / opening_bid / sale_open_date / sale_close_date / lot# / property_type; APN via assessor join); freshness §4 (`sale_open_date` + `sale_close_date` + `source_pull_ts`); robots/ToS §5; rejection criteria §6. Distinct source class from the RESO/MLS pilot (MLS active listings), the HUD HomeStore pilot (FHA-insured REO), and the USDA-RD pilot (rural-development REO) — this is federal **surplus** real-property auctions, broadening the federal-REO/surplus on-market lane to its third connector.; File GSA agency public-records / FOIA request for bulk real-property auction inventory (lot-level table: lot#, situs, opening_bid, sale_open_date, sale_close_date, status, property_type); confirm receipt cadence. (FOIA = lawful bulk path.); Confirm auction-refresh cadence; record a market row in `data/source-registry`: `{source: gsa_auctions_real_property, bulk_path: foia, cadence, last_fetched, status}`.; Stamp VERIFIED once bulk path + refresh cadence confirmed; until then DRAFT PILOT..
Use case basis: official government/public-record feed.
```

