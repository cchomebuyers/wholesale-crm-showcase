# Official Government On-Market / New-Listing Feed Candidate — 2026-06-27

**Focus task:** Official on-market / new-listing feed candidate (lawful source discovery).
**Lane:** Broadens the on-market feed lane beyond RESO Web API (official MLS) + RentCast. These are official U.S. federal-government REO / surplus real-property listing feeds — lawful, public, no MLS-portal scraping, no Zillow/Redfin/Realtor.com/CoStar, no people-search sites.
**Status:** DRAFT source-intelligence candidate (GLM iter 126, 2026-06-28). Not yet connector-ready.

## Lawful basis
Federal agencies disposing of real property (foreclosed/REO and surplus) publish on-market listings to the public on official agency domains. HUD HomeStore, USDA-RD resales, and GSA Auctions are the official disposition portals. These are official government publications / public records, freely usable. Owner-of-record is the agency (motivated seller), not a private individual — no third-party contact-list purchase, no gated PII.

## Candidate sources (official, federal)

### Candidate G1 — HUD HomeStore (HUD REO 1–4 unit residential)
- **Official URL:** `https://www.hudhomestore.com` — HUD's official REO disposition portal (contractor-operated on HUD's behalf). Parent agency: U.S. Dept. of Housing and Urban Development.
- **Access path:** public browse/search UI by state/county/price/status (no login for browsing). Bulk export not offered via UI — pair with a HUD FOIA request (5 U.S.C. § 552) for bulk inventory.
- **Fields available (per listing):** situs address, list price, list date, HUD case number, status (e.g., IN/PIE/UC), bid deadline, property type, beds/baths, FHA-insurability flag. APN not consistently exposed — join via situs → county assessor.
- **Freshness field:** `list_date` + `status_change` + `bid_deadline` (+ `source_pull_ts`). Nightly refresh.
- **Robots/terms:** honor robots.txt + HUD site ToS; prefer periodic manual retrieval or FOIA bulk over page-crawl; rate-limit; no CAPTCHA evasion.

### Candidate G2 — USDA Rural Development REO resales
- **Official URL:** `https://www.resales.usda.gov` — USDA-RD Single Family Housing REO. Agency: U.S. Dept. of Agriculture Rural Development.
- **Access path:** public "Browse Available Properties" state/county search; per-state listing tables. No documented API — pair with USDA public-records request for bulk.
- **Fields:** situs address, list price, listing date, status, property type, agency case number. APN not exposed — join via situs → assessor.
- **Freshness:** `listing_date` + `status` (+ `source_pull_ts`).
- **Robots/terms:** official `.usda.gov`; respect robots/ToS; rate-limit; no hostile crawl.

### Candidate G3 — GSA Auctions (federal surplus real property)
- **Official URL:** `https://www.gsaauctions.gov` — real-property + surplus auctions. Agency: U.S. General Services Administration.
- **Access path:** public auction browse (category: Real Property); per-lot detail pages with bid deadlines.
- **Fields:** situs address, minimum/opening bid, auction open/close date, lot/sale number, property description. Distress signal = federal surplus disposal.
- **Freshness:** `sale_open_date` + `sale_close_date` (+ `source_pull_ts`).
- **Robots/terms:** official `.gov`; respect robots/ToS; rate-limit.

## Why it fits the wholesale lead pivot
Government REO / surplus listings are pre-qualified motivated-seller-equivalent inventory (agency as motivated seller) — lawful, public, fresh. Distress + equity signals derivable from list price vs. assessed value (join to owner/tax-roll pilots via situs/APN). Complements — does not replace — the RESO MLS active-listing feed for arms-length market context.

## Freshness handling (cross-candidate)
Authoritative freshness anchor = `list_date` / `sale_open_date`; secondary = `status_change` / `bid_deadline` / `sale_close_date`; record `source_pull_ts` per retrieval. Re-poll cadence: daily (HUD/USDA refresh nightly; GSA per auction cycle).

## Robots / terms note (all candidates)
- Official agency domains only. Honor robots.txt and each site's terms-of-use.
- Prefer FOIA / public-records bulk request or periodic manual retrieval over page-by-page crawling; rate-limit; no CAPTCHA evasion; no scraping of MLS portals or Zillow/Redfin/Realtor.com/CoStar.
- Listing broker/agent contact fields (where shown) are gated per CRM contacts policy — do not republish raw PII to unscoped surfaces. B2B files preserved untouched.

## Rejection criteria (per candidate)
- Source is an aggregator / people-search site → reject.
- Requires hostile scraping or CAPTCHA evasion → reject.
- Lacks any freshness field (list_date / sale date / status timestamp) → reject.
- Gates listings behind a paid / non-public API → reject (FOIA acceptable; paid API is not).
- Re-hosts Zillow/Redfin/Realtor.com/CoStar data → reject.
- Missing situs address (no APN join path) → reject.

## Next step
- DRAFT candidate (this loop, iter 126).
- Next bounded loop: promote **G1 (HUD HomeStore)** to a connector-ready pilot manifest mirroring `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` structure (official URL / access path / field map / freshness / robots-ToS / rejection criteria / build steps); confirm HUD FOIA bulk path + nightly-refresh cadence before stamping VERIFIED.
- Joins to existing pilots: situs → assessor APN join to the 6 county owner/tax-roll pilots (Maricopa AZ, Miami-Dade FL, Clark NV, Harris TX, Santa Clara CA, Los Angeles CA) for equity/motivation scoring.

## Files
- This report: `data/source-registry/onmarket-official-gov-feed-candidate-2026-06-27.md`
- **Inspected this loop:** `data/source-registry/owner-taxroll-candidate-2026-06-27.md` — read in full; its "Status reconciliation (GLM iter 88)" section confirms owner/tax-roll discovery is ACHIEVED/superseded (6 county pilots) and explicitly hands the next step to the on-market feed lane.
- **Intentionally skipped this loop (bounded):** `data/source-registry/onmarket-feed-candidate-2026-06-27.md` and `data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md` (RESO/RentCast lane — distinct source class; no overlap with federal REO feeds); `data/source-registry/property-intelligence-status.md`.
