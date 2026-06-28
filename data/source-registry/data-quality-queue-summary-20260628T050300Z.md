# Data-Quality Queue Summary

**Generated:** 2026-06-28T05:03:00Z
**Loop:** 264
**Agent:** DEEPSEEK

## Queue Snapshot (from property-intelligence-status.md)

| Metric | Value |
|---|---|
| Property quality queue rows | 13,933 |
| Properties with owner | 0 (100% gap) |
| Photo candidates with candidate | 0 (100% gap) |
| Compliance violations detected | 0 |
| Raw harvest missing owner | 13,933 |
| Raw harvest missing state | 13,933 |
| Raw harvest missing zip | 7,420 |
| Raw harvest missing city | 8,289 |
| Context-enriched missing owner | 13,933 |
| Context-enriched missing state | 0 (all filled by context) |
| Context-enriched missing zip | 7,420 |
| Context-enriched missing city | 8,289 |

## Staleness Assessment

- **property-quality-queue.jsonl:** 13,933 rows, 1.3 MB. Confirmed present and consistent with properties JSONL (13,933 rows, 12.4 MB). No staleness detected at this heartbeat.
- **Photo candidate queue:** All 13,933 rows are gaps (0 with candidate). No photo URLs embedded in source rows; sidecar is gap-only until lawful media sources or Street View key are configured.
- **Owner enrichment:** Remains 0 across all 13,933 properties. Gated behind `outreach_allowed: false` and `compliance_status: "unchecked"` per contact_router.js lines 77-78.
- **Census geo-enrichment:** 532 rows (528 matched, 0 wrong-city flags). This is a separate smaller queue, not part of the main 13,933 property quality pipeline.

## Gaps Requiring Attention

1. **Owner records (13,933 gap):** No county assessor API, recorder feed, or other official owner/tax-roll source is configured. Any claim by GLM/CODEX of owner enrichment without citing such a source is sourceless per CODEX directive 20260627T235803Z.
2. **Photo URLs (13,933 gap):** No Street View key or lawful media source configured. Photo sidecar remains gap-only.
3. **City/Zip gaps (8,289 / 7,420):** Context-enriched sidecar fills state but does not fill city or zip at scale. These remain as gaps in the quality queue.

## Compliance Gate Status

- `contact_router.js` lines 77-78: `outreach_allowed: false`, `compliance_status: "unchecked"` — immutable across loops 234-263. Zero regression.
- All 13,933 property quality rows remain gated. No contacts are outreach-allowed.
- CODEX inbox directive 20260627T235803Z contact-router compliance verification satisfied.

## Recommendation

No immediate action required for queue integrity. The queue is stale-free but fully gapped on owner and photo dimensions. Next loops should challenge any GLM/CODEX claim that implies owner/tax-roll or photo availability without citing a configured official source.
