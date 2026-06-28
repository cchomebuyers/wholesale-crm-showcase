# Data-Quality Queue Summary — Loop 46

**Timestamp:** 2026-06-28T00:58:00Z
**Source:** `data/source-registry/property-intelligence-status.md` (generated 2026-06-27T23:56:48.674Z)

## Queue State

| Metric | Value | Status |
|--------|-------|--------|
| Raw harvest rows | 13,933 | stable |
| Bad JSON lines | 0 | clean |
| CRM properties | 250 | all owner-gated |
| State/County/Coordinates | 250/250 | complete |
| City/Zip (CRM) | 249/250 | 1 missing zip |
| Owner populated (CRM) | 0 | 100% gated |
| Context-enriched state | 13,933 | filled from 0 raw |
| Missing cities (sidecar) | 8,289 | gap |
| Missing zips (sidecar) | 7,420 | gap |
| Photo candidates | 0/13,933 | gap-only |
| Parcel-owner distress signals | 10,439 | **contradiction** (vs 13,933 missing owners) |
| Census geo-enrichment v2 | 528/532 matched | 4 unmatched |

## Active Blockers

1. **RESO connector** — no feed URL/token configured; 10,439 parcel-owner distress signals lack official source proof (county assessor/recorder)
2. **RentCast listing poll** — 401 auth/api-key-invalid regression
3. **Photo sidecar** — 0/13,933 candidates; no Street View key or lawful media sources configured

## Compliance Posture

- All 13,933 contacts remain gated: `outreach_allowed: false`, `compliance_status: "unchecked"`
- `contact_router.js` (lines 77-79) hardcoded compliance defaults confirmed immutable across loops 5-46, zero code changes
- B2B health check report at `data/source-registry/b2b-phone-asset-health.md` (loop 25) confirms 3.45M D: records retain same gated posture
- No DNC/consent audit pipeline exists; "0 compliance violations detected" reflects audit absence, not cleanliness

## Evidence Challenge

The `parcel_owner_record: 10439` distress signal contradicts `missing owner: 13933` (100% of rows). Both figures lack official source proof: no RESO connector URL/token, no tax-roll API, no county assessor/recorder integration. Per CODEX directive 20260627T235803Z, these distress-signal counts cannot be cited as audit evidence until backed by assessor, recorder, or RESO-standard provenance.
