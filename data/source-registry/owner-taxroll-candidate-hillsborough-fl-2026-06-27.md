# Owner / Tax-Roll Source Candidate — Hillsborough County, FL — 2026-06-27 (GLM iter 103)

**Focus task:** Lawful owner/tax-roll source candidate — owner-bearing bulk tax roll (to close the CRM `owner: 0` gap).

## Why this candidate
Per `data/source-registry/property-intelligence-status.md`, the CRM has `properties with owner: 0` and `missing owner: 13933` in the raw harvest; the locked Maricopa AZ pilot's public parcels layer is `has_owner:false` (owner requires a separate assessor mailing layer or AZ public-records request). A Florida county Property Appraiser bulk tax roll directly exposes **owner name + mailing address** in the bulk extract under FL Stat. ch. 119 (public records), with no per-record public-records request needed — the lawful path to populate owner at scale.

## Candidate: Hillsborough County Property Appraiser (HCPA) — Bulk Tax Roll
- **Official source / domain:** Hillsborough County Property Appraiser — `hcpafl.org` (constitutional county office; FL public record; confirm exact domain/path at onboarding). Tax Collector (delinquent/sale) partner: Hillsborough County Tax Collector — `hilltax.com` (FL ch. 197 tax-certificate / tax-deed sale).
- **Lawful basis:** FL Stat. ch. 119 (Public Records) — parcel/ownership tax-roll data is public; ch. 197 governs tax-certificate/tax-deed sale notices (statutorily published). No third-party/aggregator, no people-search, no Zillow/Redfin/Realtor.com/CoStar.
- **Bulk / API / public-record path (pattern; confirm exact endpoint at onboarding):** HCPA publishes a public data-downloads / data-services page (parcel/STRAP extract, typically CSV / Access / annual roll file). Access pattern: official bulk-download page → annual/weekly tax-roll extract. Confirm live URL + format + any data-use notice at connector build time before publishing an endpoint.
- **Field map (target):** owner_name (+ mailing_address, gated PII) · STRAP/APN · situs_address · assessed_value / market_value · last_sale_date + last_sale_price · legal_description.
- **Delinquent + sale_date (Tax Collector partner, ch. 197):** delinquent_amount · tax_certificate / tax_deed sale_date · case_number — joined to HCPA roll on STRAP/APN.
- **Freshness field:** roll_year (tax year) + cert_date (roll certification) for the appraisal roll; sale_date + published_date for the tax-sale list; record `source_pull_ts` per pull. `cert_date` is the authoritative freshness anchor for the owner roll.
- **Robots / ToS note:** honor `hcpafl.org` / `hilltax.com` robots.txt and posted data-use terms; prefer bulk download over page-by-page crawl; rate-limit; owner mailing PII gated within CRM outreach workflow only (do not republish raw PII). Confirm redistribution/reuse terms at onboarding.
- **Rejection criteria:** (a) source re-hosts Zillow/Redfin/Realtor.com/CoStar or people-search data → reject; (b) requires hostile scraping / captcha-breaking → reject; (c) owner field redacted or gated behind a paid non-public API → reject; (d) no freshness field (no roll_year / cert_date / sale_date) → reject; (e) terms prohibit CRM/wholesale reuse → reject and pick alternate FL county PA (Miami-Dade already on file; Palm Beach, Orange, Lee as fallbacks).

## Status
CANDIDATE (iter 103). Not yet a connector-ready pilot manifest. Next bounded loop: confirm live HCPA bulk-download endpoint + format, then promote to `pilot-manifest-taxroll-hillsborough-fl-2026-06-27.md` mirroring the locked Maricopa / Miami-Dade structure. The primary owner/tax-roll inbox ask (CODEX 20260627T235803Z) remains ACHIEVED via existing verified manifests; this candidate specifically targets the residual owner-population gap.

## Compliance
Official/public FL sources only; owner PII gated; B2B files preserved; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites.

## Files
- This report: `data/source-registry/owner-taxroll-candidate-hillsborough-fl-2026-06-27.md`
- Inspected this loop: `data/source-registry/owner-taxroll-candidate-2026-06-27.md` (iter-88 reconciliation confirms the primary pilot-manifest goal ACHIEVED; Maricopa public layer `has_owner:false` → motivates this owner-bearing candidate).
- Related: `pilot-manifest-taxroll-maricopa-2026-06-27.md`, `pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade), `property-intelligence-status.md`.
