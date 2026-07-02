# Fill Properties — the one-button, no-spend pipeline

The **⚡ Fill Properties** tab in the operator app runs the property enrichment →
tiering → export chain end-to-end from a single button, then shows the resulting
`pro_queue` with post-processing filters. **No money is spent by this chain.** The
only paid action in the system — per-property skip-trace — is deliberately *not*
part of it; it stays a separate, human/AI-gated step
(`POST /api/pro-queue/:propertyId/skiptrace`).

## Pieces

- **Orchestrator:** `pipeline_run.js` — ordered stage manifest (`PIPELINE_STAGES`),
  presets (`PIPELINE_PRESETS`), selection (`resolveStageIds`), and `runPipeline()`
  which runs each stage sequentially as a child process with `PIPELINE_RUN=1`
  (so the tools bypass their autonomous-loop `docs/HALT` guard for a user-initiated
  run) and `NO_BACKUP=1`. Tests: `pipeline_run.test.js`.
- **API** (`server.js`):
  - `POST /api/pipeline/run` — body `{ preset?: "local"|"full", stageIds?: [], hotScore?, minScore?, maxSources?, pages? }`. Starts a background run, returns `{ run_id }`. One run at a time (`409` if already running).
  - `GET /api/pipeline/runs/:id` — live run + per-stage status (polled by the UI).
  - `GET /api/pipeline/runs` — recent runs. `GET /api/pipeline/stages` — manifest.
  - `GET /api/pro-queue` — extended with post-processing filters (below).
  - Run records persist in the `pipeline_runs` table.
- **UI:** `public/index.html` + `public/app.js` (`loadFill`/`runFill`/`pollFill`/`reloadFillQueue`), styles in `public/styles.css`.

## Stages (execution order)

`harvest → context → geocode → geo_apply → owners → portfolio → arv → buyers →
grade → build → export`. The local re-tier core — **grade → build → export** — is
required (a failure aborts the run); the network/enrichment stages are optional
(best-effort; a failure is recorded and the chain continues).

- **Local re-tier** preset = `grade, build, export` — fast, no network, no spend.
  Re-ranks the existing `properties` rows into fresh tiers. Use this most of the time.
- **Full pull** preset = the whole manifest — also harvests + enriches first
  (network, slower; still no spend).

Tiering itself is `classifyProQueue()` in `pro_wholesaler_queue.js`
(`call_now` / `pay_to_unlock` / `research` / `hold`).

## Post-processing filters on `GET /api/pro-queue`

All optional, all applied after the queue is built:

| Param | Effect |
|-------|--------|
| `tier` | CSV multi-select, e.g. `tier=call_now,pay_to_unlock` |
| `min_score` | `priority_score >= N` |
| `min_grade` | `property_grade >= N` (column referenced only if present) |
| `owner_known=1` | owner-of-record known |
| `distress=1` | distress signal present |
| `spread=works|thin|fails|unproven` | spread status |
| `signal=absentee|entity|institutional` | owner-type signal |
| `ready=1` | call-now-ready (no blockers) |
| `limit` | cap rows (default 100) |

Response: `{ counts, items, total, returned }`. Each item carries `why_not_call_now`
(ordered blockers) and `call_now_ready`.

## Verified live (2026-06-30)

Local run via the button: `grade ✓ → build ✓ → export ✓`, queue rebuilt to
`pay_to_unlock: 401`; filters return correct subsets; pursuable export written to
`pursuableLeads/skiptrace_targets.{csv,jsonl}`. Zero network calls, zero spend.
