# focus/ — the 9 productivity agents + Focus Terminal

Goal: offload the extensive real-estate workload onto agents so the operator can
focus, with an ADHD/concentration layer (the Focus Terminal) that keeps one next
action in front of them at all times.

**One funnel.** Every agent's output is rows in the `tasks` table (server.js:112)
plus lead-field updates — so everything surfaces in one place: the Focus
Terminal and the CRM dashboard. **No agent contacts anyone or spends money**;
anything outward-facing becomes an approval task for the human. (Agent 6's
sends are human-approved in the Outreach tab; its opt-in `EMAILER_AUTO_SEND=1`
is the one deliberate exception, and it only emails addresses already on file.)

## Run

```
npm run focus                        # the terminal (or double-click Focus.command)
node focus/agents/momentum.mjs       # Agent 4 — follow-ups + stuck leads → tasks
node focus/agents/acquisitions.mjs   # Agent 1 — lead-engine shortlist → leads + review tasks
node focus/agents/underwriting.mjs   # Agent 2 — ARV → MAO/offer → "Send offer" tasks
node focus/agents/outreach.mjs       # Agent 3 — offer-ready leads → drafts + approval tasks
node focus/agents/emailer.mjs        # Agent 6 — offer emails in Sonny's voice → email_queue + approval tasks
```

All read/write `crm.db` directly (`CRM_DB=` overrides), run once, print a
one-line digest, exit 0. Safe to run any time, in any order — every task write
is idempotent (`addTaskOnce`: exact-title dedupe while open).

## The agents

| # | Agent | Input | Output | Knobs |
|---|-------|-------|--------|-------|
| 1 | **Acquisitions Autopilot** (`agents/acquisitions.mjs`) | `lead_engine_candidates` (filled hourly by `autonomous_lead_engine.js`, server.js:3344) | promotes score≥70 shortlist → `leads` (stage New, `addr_canon` dedupe), task `Review new lead: {address}` | `MIN_SCORE`, `MAX_PROMOTE` |
| 2 | **Underwriting Analyst** (`agents/underwriting.mjs`) | open leads with `arv`, no `mao` | writes `mao = ARV×0.70 − repairs − fee`, `offer_amount`, activity note; task `Send offer on {address} — MAO $X`. No-ARV leads → `needs comps` task | `UW_TARGET_FEE` (10k), `UW_REPAIR_PCT` (0.10) |
| 3 | **Compliant Outreach Drafter** (`agents/outreach.mjs`) | priced leads with a phone/email on file | seller script draft in the activity feed, task `Approve & send outreach…`. **Never sends.** Contact *discovery* stays with `contact_router.js` (free routes, DNC/consent gate) | `MAX_DRAFTS` |
| 4 | **Momentum Keeper** (`agents/momentum.mjs`) | `next_followup`, latest `call_outcomes.follow_up_date`, leads untouched > 7d | dated follow-up / call-back / unstick tasks | `STUCK_DAYS` |
| 5 | **Focus Coach** (`focus-coach.mjs`) | KPIs + tasks + follow-up queues | ONE ordered plan; single next action with timebox; splits big tasks ("Call 20 sellers" → "Call the next 1"). Deterministic ranker; optional Claude polish (`ANTHROPIC_API_KEY` or `CRM_COACH_AI=1`) | — |
| 6 | **Sonny Emailer** (`agents/emailer.mjs`) | offer-ready leads (email on file + priced offer, none sent), `templates`, `sonny-voice.md` | one offer email per lead into `email_queue` (status draft) + approval task. Realtor vs homeowner template auto-picked (`email_agent.js` classifies by source / "(listing agent)" tag); merged, then AI-rewritten in Sonny's voice when the Anthropic key is connected (falls back to the clean template merge). **You review + send from Outreach → 🤖 Sonny Email Agent** (per-email or Send all); sending stamps `offer_sent_at` + advances the stage exactly like a hand-sent offer | `EMAILER_AUDIENCE` (both\|realtor\|homeowner), `EMAILER_MAX` (8), `EMAILER_TEMPLATE_ID`, `EMAILER_AI` (1), `EMAILER_AUTO_SEND` (0), `EMAILER_EARNEST` (1000), `EMAILER_INSPECT_DAYS` (10), `EMAILER_CLOSE_DAYS` (30) |
| 7 | **System Doctor** (`agents/doctor.mjs`) | live system state: `/api/health`, `PRAGMA quick_check` + orphan counts, `backups/` mtimes, `settings.inbox_synced_at`, funnel queries (uncontactable / stale-New / offer-ready), last 200 `server.log` lines, integration key *presence* (names only, never values) | one `Fix: …` task per failing check (exact-title dedupe), stderr detail lines, digest `N critical, N warn, N ok` | `CRM_URL` (http://localhost:4000) |
| 8 | **Comps Analyst** (`agents/comps.mjs`) | active leads missing `arv`/`mao` | calls the CRM's free Detroit comps engine (`POST /api/leads/:id/underwrite` — parcel file + recorded sales, $0) per lead; writes land on the lead (arv/repairs/mao/score); files `Send offer on {address} — MAO $X` when it clears, `Needs manual comps: {address}` when Detroit data can't price it | `COMPS_MAX` (10), `CRM_URL` |
| 9 | **Reply Triage** (`agents/replies.mjs`) | inbound `emails` rows matched to a lead (`direction='in'`, `lead_id` set) | deterministic classify — interested / counter / not-interested / question; logs a `🤖 Reply triage` activity (dedupe key `[triage #emailId]`), advances New/Contacted → Follow-Up on interest, files the next-action task. **Never marks a lead Dead** — files `Confirm dead?` for the human | — |

Priority ladder (Agent 5): due follow-ups → offer-ready approvals → tasks due
today → biggest KPI gap as one small step → the rest.

## The Focus Terminal (`focus-terminal.mjs`)

Dependency-free ANSI TUI (house style: `MatrixBoot`, crm-app.mjs:40). Panels:
header + streak → **NEXT ACTION** (one thing, big) → tasks with progress bar →
KPI bars (targets in `daily-goals.json`) → Pomodoro timer → agent approval
queue. Keys: `↑↓/jk` select · `space` done · `n` brain-dump · `f` focus timer ·
`r` refresh · `q` quit. Non-TTY (`| cat`, cron) prints a one-shot digest.
KPI queries mirror `GET /api/stats` (server.js:1763) exactly, incl. the 9am-ET
offer cutoff.

ADHD design: one next action (never a wall) · visible timebox · instant
brain-dump capture (`n`) so stray thoughts park instead of derail · streak/green
dopamine on completion · big tasks auto-shrunk to the next single step.

## Scheduling (optional, later)

Each agent is interval-safe. To automate, either add `safeTick` + `setInterval`
entries in server.js beside the existing loops (inbox :1504, auto-scan :2013,
lead engine :3344, backup :3563), or cron the standalone commands. Left
unwired on purpose — run them by hand until the outputs earn trust.
