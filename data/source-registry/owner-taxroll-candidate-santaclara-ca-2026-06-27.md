# Owner / Tax-Roll Source Candidate — Santa Clara County, CA (2026-06-27)

**Focus task:** Lawful owner/tax-roll source candidate — second-jurisdiction expansion of the owner/tax-roll lane.
**Loop:** GLM iter 91 (bounded). All three primary pilots (tax-roll Maricopa/Miami-Dade/Clark/Harris, on-market RESO, photo/imagery Miami-Dade) are VERIFIED connector-ready; per each manifest §9 the next source-discovery move is to expand a lane to a second jurisdiction. This candidate expands the tax-roll lane into California, where the harvest's missing-owner gap is concentrated (top sources all CA parcel/violation layers, `missing owner: 13933`; `santaclara-ca-parcels: 1997` is the #1 source).
**Lawful basis:** California Public Records Act (Gov. Code §6250 et seq.) — the secured property tax assessment roll is a public record. Ownership **name** is public under Rev. & Tax. Code §408. Delinquent/tax-defaulted property lists and notices of power-to-sell are statutorily published under Rev. & Tax. Code §3461/§3471. Official `.gov` sources only; no hostile scraping; no Zillow/Redfin/Realtor.com/CoStar; no people-search sites. Owner contact PII gated.
**CA-specific gating note (important):** Under Rev. & Tax. Code §408.1, an owner's **mailing address** is NOT freely available for mass solicitation — it is restricted to requesters certifying non-solicitation use, or via the assessor's own opt-out-aware process. Therefore this pilot captures **owner name + APN + situs + roll/assessment fields** as the public-record layer; mailing-address capture is gated/optional and must be obtained via the assessor's lawful request path, never mass-scraped. This is consistent with the existing "contacts gated" rule.

## Candidate: Santa Clara County Assessor (secured roll) + Dept. of Tax and Collections (tax-defaulted list)

**Two paired official sources, same county, same APN key:**

### A. Santa Clara County Assessor — secured assessment roll (owner + APN + situs + value)
- **Official domain:** `https://www.sccassessor.org/` (.gov — official).
- **Parcel search (pattern; verify exact path at build time):** `https://www.sccassessor.org/assessor-property-search` → per-APN result exposes owner **name** (public under §408), situs, APN/parcel, assessed value, assessment/roll year, legal description. Mailing address gated per §408.1.
- **Bulk/open-data path (preferred for batch):** Santa Clara County open-data portal (official `.gov`) publishes parcel/assessment layers; verify the current hub URL + license at build time. Alternatively file a CPRA (Gov. Code §6253) request to the Assessor for the secured-roll extract (owner name, APN, situs, assessment_year) — the lawful bulk path; capture PR-request reference + fulfillment date.

### B. Santa Clara County Department of Tax and Collections (DTAC) — tax-defaulted property list (distress signal)
- **Official domain:** `https://www.sccdtc.org/` (.gov — official; DTAC is the county tax collector).
- **Tax-defaulted list (pattern; verify at build time):** DTAC publishes properties that have defaulted to tax-defaulted status (Rev. & Tax. Code §3461) and notices of power-to-sell (§3471) — statutorily mandated public notices. Look for a "tax-defaulted properties" / "redemption" roster (PDF or download) and/or a CPRA request path.
- **What it yields:** APN, owner name, situs, defaulted amount/years, redemption deadline / pending sale date — distress + freshness anchor, joinable to Assessor roll on APN.

## Field map (source → CRM)
| CRM field | Source field | Source | Notes |
|---|---|---|---|
| apn / parcel_id | APN / parcel number | Assessor + DTAC | join key |
| owner_name | Owner of record (name) | Assessor | public under §408 |
| owner_mailing | Owner mailing address | Assessor | **GATED** — §408.1; lawful request path only, not mass-scraped |
| situs | Property address | Assessor | geo key |
| assessed_value | Assessed / roll value | Assessor | equity signal |
| assessment_year | Roll / assessment year | Assessor | freshness anchor |
| delinquent_amount | Defaulted tax + penalties | DTAC | distress signal |
| delinquent_years | Tax years defaulted | DTAC | distress signal |
| sale_date | Redemption deadline / sale date | DTAC | freshness anchor (statutory sale cycle) |
| (aux) last_fetched | connector pull timestamp | connector | per-APN freshness |

## Freshness field
- Roll layer: `assessment_year` (secured roll is annual in CA).
- Tax-defaulted layer: `sale_date` (redemption deadline / power-to-sell notice date) — authoritative distress-freshness anchor; statutory cycle.
- Per-pull: `last_fetched`, recorded per APN in the connector manifest.

## robots.txt / ToS note
- Honor `https://www.sccassessor.org/robots.txt` and `https://www.sccdtc.org/robots.txt` + each site's terms of use.
- Prefer the open-data bulk download and/or a CPRA public-records request over page-by-page crawling; rate-limit; no concurrent bursts.
- Do NOT bypass any captcha/anti-bot gate — STOP and use the CPRA request path.
- Owner mailing address stays gated (§408.1); owner name public; B2B files preserved; no co-mingling with B2B contact lists.

## Rejection criteria (reject this county/source if any hold)
- Assessor provides no machine-readable roll AND no CPRA bulk path → reject.
- No APN OR situs OR owner name field available → reject (field map unmet).
- No assessable freshness field (neither `assessment_year` nor `sale_date`) → reject as stale/unverifiable.
- ToS/data-use statement prohibits CRM/wholesale reuse of the roll → reject (cannot gate around a statutory/contract prohibition).
- Source provenance traces to a people-search/aggregator or a portal-scrape (Zillow/Redfin/Realtor.com/CoStar) → reject.
- robots.txt disallows the parcel-search/roll path → respect it; fall back to CPRA request only if that path is permitted, else reject.

## Status / next step (this loop)
- **This loop:** Seeded the Santa Clara County CA tax-roll candidate (second-jurisdiction expansion) with official URLs, CPRA/bulk access path, full field map (owner/APN/situs/delinquent_amount/sale_date), freshness field, robots/ToS note, and rejection criteria — matching the CODEX-required manifest structure.
- **Next loop (if assigned):** Promote this candidate to a VERIFIED connector-ready pilot manifest (`pilot-manifest-taxroll-santaclara-ca-2026-06-27.md`) mirroring the Maricopa/Miami-Dade structure; ground jurisdiction against the existing `santaclara-ca-parcels` registry row in `data/source-registry/county-source-registry.jsonl`.
- **Queue held:** On-market RESO feed (VERIFIED, build-time remaining: per-MLS base URL + OAuth2 + DUA) and lawful photo/imagery metadata (VERIFIED Miami-Dade pilot, build-time remaining: photo-endpoint URL + Ch.119 PR fulfillment) remain in queue per CODEX inbox 20260627T235803Z.

## Files / provenance
- This report: `data/source-registry/owner-taxroll-candidate-santaclara-ca-2026-06-27.md`
- Inspected this loop: `data/source-registry/property-intelligence-status.md` (confirmed `missing owner: 13933` + `santaclara-ca-parcels: 1997` top source — the gap this candidate targets).
- Template / verified prior pilots (not re-inspected, bounded): `data/source-registry/pilot-manifest-taxroll-maricopa-2026-06-27.md`, `.../pilot-manifest-county-taxroll-2026-06-27.md` (Miami-Dade FL, Ch. 119), `.../owner-taxroll-candidate-2026-06-27.md`.
- Intentionally skipped this loop (bounded): `data/source-registry/county-source-registry.jsonl` deep read (deferred to the manifest-promotion loop for jurisdiction grounding against `santaclara-ca-parcels`).
