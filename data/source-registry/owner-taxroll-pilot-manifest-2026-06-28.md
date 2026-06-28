# Owner / Tax-Roll Pilot Manifest — Hillsborough County, FL (Official)

- Iteration: 165 (GLM heartbeat 2026-06-28)
- Source class: official county tax collector + property appraiser (lawful public record)
- Status: connector-ready pilot manifest (candidate, not yet wired)

## 1. Source identity
- Jurisdiction: Hillsborough County, Florida
- Tax Collector (delinquency + tax certificate / tax deed sales): https://www.hillstax.org/
- Property Appraiser (owner / APN / situs / assessment): https://www.hcpafl.org/
- Authority: official county offices operated by the elected Tax Collector and Property Appraiser; public records under Florida law (F.S. ch. 119 public records; ch. 197 tax collections; ch. 192 assessments).

## 2. Lawful access path (public record, no hostile scraping)
- Tax Collector publishes: annual tax certificate sale list, tax deed sale files, and delinquent tangible personal property lists. Florida tax certificate sales run via the Tax Collector's contracted auction platform (Grant Street Group / Hosted Bid Systems pattern); published sale files are downloadable public record during the statutory sale window.
- Property Appraiser publishes: parcel search by owner / site address / parcel ID; downloadable GIS parcel shapefile + CAMA extract; annual Certified Tax Roll.
- No login/paywall for the public record search; bulk GIS data offered for download (verify redistribution terms per dataset).
- Do NOT scrape people-search sites, Zillow/Redfin/Realtor/CoStar. Use only the two official offices above.

## 3. Connector fields (target schema)
| Field | Source office | Path |
|---|---|---|
| owner_name | Property Appraiser | parcel search / CAMA extract |
| parcel_id (APN) | Property Appraiser | parcel search / GIS |
| situs_address | Property Appraiser | parcel record |
| delinquent_amount | Tax Collector | delinquency / certificate file |
| sale_date | Tax Collector | certificate sale / tax deed sale date |
| legal_description | Property Appraiser | parcel record |
| use_code | Property Appraiser | parcel record |

## 4. Freshness field
- Primary freshness: `sale_date` (tax certificate sale date / tax deed sale date) from Tax Collector.
- Secondary freshness: Tax Collector delinquency as-of date (statutory lien date, typically March 31 / April 1) and Property Appraiser roll year (January 1 assessment date).
- Connector must record `fetched_at` (UTC) and the roll/sale year alongside each record.

## 5. robots / terms note
- Official public-record sites; Florida public records law favors access.
- Respect any posted robots.txt and rate limits; prefer cached bulk files over per-record page hits.
- Verify Property Appraiser GIS data-use terms before redistribution; internal CRM use is within public-record norms.
- Tax certificate sale data is time-bounded by the statutory sale window; fetch the published file; do not replay expired sale data as current.

## 6. Rejection / non-pilot criteria
Reject or defer the pilot if:
- Domain is not the official county site (no third-party aggregators).
- owner/APN/situs/delinquent_amount/sale_date cannot all be obtained from the two official offices.
- Source requires scraping people-search or listing portals.
- No freshness / sale-date field can be confirmed.
- Bulk file is paywalled with redistribution restrictions incompatible with CRM use.

## 7. Next connector steps (queued, not executed this loop)
1. Confirm exact Tax Collector sale-file URL + format (CSV/Excel) for the current sale year.
2. Confirm Property Appraiser GIS/CAMA bulk download URL + schema.
3. Map fields to CRM lead schema; add delinquency + sale_date freshness gates.
4. Keep on-market RESO/RentCast/official MLS feed research and lawful photo/imagery metadata research in queue.

## 8. Provenance / intentional skips
- Manifest authored from official public-record knowledge of Hillsborough County offices; specific sub-URLs to be verified at connector build time.
- `data/source-registry/owner-taxroll-candidate-2026-06-27.md` intentionally NOT inspected this loop (per heartbeat no-inspect rule); to be reconciled next loop.
