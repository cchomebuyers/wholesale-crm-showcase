# Operator actions — what only YOU can do (2026-07-02)

The autonomous loop built and verified everything code-side; these are the
remaining human/spend/credential actions, in money-loop order. Each cites its
groundwork. Code state: 478 tests green; UI = command shell at
http://localhost:4000 (`npm start`).

## 1. Fund + run skip-trace on the pursuable list  → fills `call_now`
- **What:** add a BatchData key (Settings → Acquisitions, or `BATCHDATA_API_KEY`),
  then work through `pursuableLeads/skiptrace_targets.csv` (401 spend-gated
  rows; regenerate any time via ⚡ Fill → Run pipeline).
- **Wave 2 queued behind it:** 292 `research` rows are phone-ONLY (owner+ARV+
  demand already complete — `GET /api/pipeline/coverage` → `promotion_yield`);
  total dialable pipeline ≈ 693 once funded.
- **Guardrails already enforced:** per-property spend gate (`skiptrace_gate.js`),
  suppressed properties 403 (`server.js` skiptrace route), found numbers stay
  `outreach_allowed:false` until DNC.
- Groundwork: `docs/fill_properties_pipeline.md`, smoke-proven gate.

## 2. DNC-check the found numbers  → phones appear on the call sheet
- **What:** run each found number through a DNC check (federal list account or
  provider), then record verdicts: `POST /api/dnc/record`
  `{phone, status: clear|listed|refused, source, channels}`.
- **Effect:** fresh `clear` flips the queue blocker AND unmasks the phone on
  `⚡ Fill → ⬇ Call sheet` (leak-proof by construction; clears expire in 30d).
- Groundwork: `dnc_records.js`, call-sheet smoke test.

## 3. CA owner coverage (84% of the db)  → unlocks 8,441 properties
- **What (per county, Riverside first):** confirm the county's secured-roll
  bulk export or file the ACRe public-records request, per
  `data/source-registry/pilot-manifest-taxroll-riverside-ca-2026-06-28.md`
  (legal basis pre-written: names public RTC §408; NEVER bulk-republish
  mailing addresses §408.1(a)).
- **LA fast path (1,206 violations/distress rows):** two concrete asks from
  `pilot-manifest-taxroll-losangeles-ca-2026-06-27.md`:
  1. **Quick official download, no login:** the Treasurer–Tax Collector
     "Tax-Defaulted Property / Publication List" at `ttc.lacounty.gov` —
     carries owner of record + APN + delinquent amount + auction date
     (statutory notice, RTC §3701). Maximum-distress owners, legally public.
     Drop the XLS/PDF in `data/` and the loop wires the parser.
  2. **CPRA request** to the LA Assessor for the Secured Annual Assessment
     Roll extract (AIN, OWNER_NAME, situs, assessed value) — Gov. Code §6253.
- **Why an operator:** live probes confirmed no owner-bearing bulk layer is
  discoverable (`councilRoom/comms/2026-07-02-ca-owner-activation-plan.md` —
  incl. the federated-hub trap). Once a file/URL exists, the loop wires the
  connector + bounded join in one tick.

## 4. ankhor88 remix: install + first launch
- **What:** on a machine with disk headroom: `cd ankhor88_remix && npm i`
  (or bun), typecheck, run; import `packs/crm.thinga.json` (program thinga →
  the CRM overlaid) and/or Smart-Import from
  `http://localhost:4000/api/export/ankhor-import` (always redacted).
- Groundwork: `dev/ankhor88-crm-compatibility.md` (ALL THREE BUILT).

## 5. dwrld monitors: the one-liner (production)
- **What:** on quandaleServer, `arena.js:323` → `mFrame.src = "/ankhor/"`.
  Plan + guardrails: `dev/ankhor-dwrld-monitors.md`. Explicitly awaiting your
  go — never applied autonomously.

## 6. Housekeeping (optional)
- `docs/HALT` still present (Jun 29) — remove it when you want the OLD
  autonomous tick wrapper (`tools/run_loop_tick.ps1`) to run again;
  user-initiated pipeline runs already bypass it via `PIPELINE_RUN=1`.
- `backups/` symlink still points at the missing D: target — server degrades
  gracefully now, but restore the target to re-enable auto-backups.
- Session cron loop dies with the Claude session; re-arm anytime with
  `/loop` or the schedule skill.
