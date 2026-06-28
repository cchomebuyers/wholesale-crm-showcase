# On-Market / New-Listing Feed Candidate — 2026-06-27

**Focus task:** Official on-market / new-listing feed candidate (bounded loop). Lawful, official/public-API sources only.
**Lawful basis:** RESO (Real Estate Standards Organization) Web API is the industry-standard, MLS-sanctioned data-access protocol. Active listings are accessed lawfully through MLS membership / IDX/VOW data-use agreements — never by scraping portal UIs. This is the canonical "official" on-market feed path.
**Prohibited:** No scraping of Zillow / Redfin / Realtor.com / CoStar; no people-search sites; no hostile scraping. Owner/agent contact fields gated.

## Candidate A (primary): RESO Web API via official MLS
- **What:** RESO Data Dictionary + Web API (OData). The official, broker-sanctioned feed of active listings, price changes, status, and new listings.
- **Official / lawful access path:**
  - MLS membership (or sponsor broker) grants a RESO Web API endpoint + OAuth2 client credentials.
  - Endpoints (RESO standard, instance-specific base URL from each MLS):
    - `GET /Property` — active + recent listings (Property resource).
    - `GET /Property?$filter=Status eq 'Active'` — on-market filter.
    - `GET /Member` / `GET /Office` — listing brokerage (for lawful brokerage attribution, not for cold-dialing agents).
  - Freshness field: `ModificationTimestamp` (RESO standard field) — authoritative record-level freshness anchor; `ListingContractDate` for new-listing origination; `StatusChangeTimestamp` for status transitions (e.g., Active → Pending).
- **Fields mapped to CRM:**
  - `listing_id` (RESO `ListingKey` / `ListingId`) — dedupe key.
  - `situs` (`UnparsedAddress` / `StreetNumber`+`StreetName`+`City`+`StateOrProvince`+`PostalCode`) — geo key.
  - `list_price` (`ListPrice`) — motivation/equity signal.
  - `status` (`Status`) + `status_change_ts` (`StatusChangeTimestamp`) — on-market freshness.
  - `days_on_market` (`DaysOnMarket`) — distress proxy.
  - `list_date` (`ListingContractDate`) — new-listing freshness.
  - `listing_member` / `listing_office` — brokerage attribution (gated; no mass agent dialing).
- **Robots / ToS note:** N/A for scraping (sanctioned API). Governed by the MLS Data Use Agreement (DUA) / IDX rules: reproduction limited to authorized surfaces, attribution required, no co-mingling with non-MLS data for public display. CRM internal use is permitted under typical broker/MLS DUAs — confirm per-MLS before import.
- **Rejection criteria (reject MLS feed as pilot source if any hold):**
  - No RESO Web API offered (XML/FTP RETS only is legacy — acceptable but flag for migration) AND no other machine-readable feed → reject.
  - DUA prohibits CRM/internal-brokerage use of active-listing data → reject (cannot gate around a contract prohibition).
  - Feed exposes no `ModificationTimestamp` / equivalent freshness field → reject.
  - Feed lacks `situs` OR `ListPrice` OR `Status` → reject (field map unmet).
  - Rate-limit / quota too low to keep DOM-fresh for target counties → reject (or scope down).

## Candidate B (secondary, documented public API): RentCast
- **What:** RentCast publishes a documented public REST API for listings / property data (not a portal-scrape). Not Zillow/Redfin/Realtor/CoStar; not a people-search site.
- **Lawful access path:** official API at `https://api.rentcast.io/v1/` (e.g., `/listings`, `/properties`) with an API key; terms permit programmatic use. Verify current ToS + rate limits before import.
- **Use case:** cross-check / gap-fill on-market + rental listings where MLS membership is not yet in place; never as a substitute for the sanctioned MLS feed.
- **Freshness field:** API response `lastSeen` / listing `listedDate` (verify field name in current API schema).
- **Rejection criteria:** ToS forbids commercial/CRM storage → reject; no freshness field → reject; relies on scraping portals for source data (verify provenance) → reject.
- **Note:** RentCast is a secondary aggregator; the lawful "official" on-market feed remains Candidate A (RESO/MLS). Treat B as supplementary only.

## Next step (declared for this loop)
Lock Candidate A as the on-market feed of record once an MLS RESO endpoint + DUA are confirmed. Stand up a connector manifest mirroring `pilot-manifest-taxroll-maricopa-2026-06-27.md` structure (official endpoint, auth, field map, freshness field, ToS note, rejection criteria). Join to the tax-roll pilot on `situs`/`APN` to flag on-market-but-tax-distressed owners.

## Files
- This report: `data/source-registry/onmarket-feed-candidate-2026-06-27.md`
- Reused as template (active owner/tax-roll pilot, LOCKED): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`
- Discovery memo (owner/tax-roll, already consumed): `data/source-registry/owner-taxroll-candidate-2026-06-27.md`
