# Ops Readiness

The **ops_readiness** read-model answers one question without reading code: *is this system
ready to source, enrich, skip-trace, DNC-check, and operate?* It surfaces server/runtime,
storage, backup, source-health, credential **presence** (never values), skip-trace readiness,
DNC posture, and recent job failures.

- Pure builder: [`ops_readiness.js`](../ops_readiness.js) — `buildOpsReadiness(input)` (no I/O).
- Report script: [`tools/ops_readiness_report.mjs`](../tools/ops_readiness_report.mjs) — gathers
  real facts and prints the JSON.
- Tests: [`ops_readiness.test.js`](../ops_readiness.test.js).

> Exposed as a **script**, not an HTTP route. In the 2026-06-30 audit run CALLNOW is the sole
> editor of `server.js`; the loop prompt allows "a read-only endpoint **or** script". A future
> route could simply `import { buildOpsReadiness }` and feed it the same facts.

## Run it

```bash
node tools/ops_readiness_report.mjs            # pretty JSON
node tools/ops_readiness_report.mjs --compact  # single-line JSON
```

The script:
- opens `crm.db` **read-only** (never mutates/VACUUMs the live DB),
- reads credential **presence** from the `settings` table and env (`getSetting(k) || process.env.X`,
  per `server.js:1626-1629` and `:1155-1159`) — it records `present: true/false` and `source`, and
  **never the secret value**,
- lists `backups/` (`server.js:2538`), and
- reads Postgres source-health only if `DATABASE_URL` is set, behind a 4 s timeout so a missing DB
  cannot hang the report.

It does **not** boot the server and does **not** create backups.

## What an operator should check BEFORE paid/contact workflows

1. **`overall.ready_to_operate` is `true`** and `overall.blockers` is empty. A missing `crm.db`
   (`server.js:57`) is a hard blocker.
2. **`overall.warnings`** is clear, or you accept each one. Common warnings: no `DATABASE_URL`
   (source-health tracking off), no backups on disk, BatchData key absent, a source failing.
3. **Backups**: `backup.status` is `ok` (run `POST /api/backup`, `server.js:2553`) before any bulk
   operation. During tests/boot checks, set `NO_BACKUP=1` so no backup is written.
4. **Credentials present** for what you intend to do (`credentials.*.present`):
   - sourcing comps/listings → `rentcast_api_key`
   - AI scoring → `anthropic_api_key`
   - **skip-trace (paid)** → `batchdata_api_key`
   - geocoding → `google_maps_api_key`
   - email outreach → `gmail_user` + `gmail_app_password`
5. **Skip-trace (`skiptrace`)**: `ready` only means the BatchData key is present. Every lookup is
   still gated by `skiptrace_gate.js` (`spend_still_gated: true`) — spend only on a spend-eligible
   tier with a known owner, a distress signal, and an ARV or buyer demand. **Presence ≠ authorization.**
6. **DNC / contact (`dnc`)**: `default_posture` is `deny_until_checked` and `auto_outreach_allowed`
   is always `false`. Per `compliance_gate.js`, a found phone/email stays `outreach_allowed:false`
   until DNC + consent are verified per channel (call needs DNC clear; SMS/email need consent;
   direct mail is ungated). There is no system-wide "ready to contact" — it is per-contact.
7. **`recent_job_failures`**: skim for failing connectors / last lead-engine error before relying
   on automated pulls.

## Read-model shape (field names)

Top-level keys: `generated_at`, `overall`, `server`, `database`, `backup`, `postgres`, `sources`,
`credentials`, `skiptrace`, `dnc`, `recent_job_failures`.

| Path | Meaning |
|------|---------|
| `overall.ready_to_operate` | bool — no hard blockers |
| `overall.ready_to_source` | bool — free connectors usable (no paid key required) |
| `overall.ready_to_skiptrace` | bool — operate AND BatchData key present |
| `overall.contact_posture` | `"deny_until_checked"` (contact is per-contact, gated) |
| `overall.blockers` / `overall.warnings` | string[] — cited reasons |
| `server.node_version` `.platform` `.pid` `.uptime_s` `.status` | runtime; `status` ∈ live/down/not_checked |
| `database.path` `.exists` `.size_bytes` `.size_mb` | `crm.db` facts |
| `backup.enabled` `.dir` `.count` `.last` `.latest` `.status` | `enabled:false` when `NO_BACKUP` set |
| `postgres.configured` | bool — `DATABASE_URL` present |
| `sources.tracking_enabled` `.total` `.healthy` `.down` `.degraded` `.note` | source-health scoreboard rollup |
| `credentials.<key>.present` `.source` | **presence only**; `source` ∈ setting/env/null |
| `skiptrace.ready` `.provider` `.provider_key_present` `.spend_still_gated` `.note` | paid skip-trace readiness |
| `dnc.contact_gate_enforced` `.default_posture` `.auto_outreach_allowed` `.note` | compliance posture |
| `recent_job_failures[]` | `{ source, kind, error, at }` — non-secret failure rows |

`credentials.<key>` covers: `rentcast_api_key`, `anthropic_api_key`, `batchdata_api_key`,
`google_maps_api_key`, `gmail_user`, `gmail_app_password` (`CREDENTIAL_KEYS` export).
