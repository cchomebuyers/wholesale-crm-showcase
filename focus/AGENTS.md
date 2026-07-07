# focus/ — the 5 productivity agents + Focus Terminal

Goal: offload the extensive real-estate workload onto agents so the operator can
focus, with an ADHD/concentration layer (the Focus Terminal) that keeps one next
action in front of them at all times.

**One funnel.** Every agent's output is rows in the `tasks` table (server.js:112)
plus lead-field updates — so everything surfaces in one place: the Focus
Terminal and the CRM dashboard. **No agent contacts anyone or spends money**;
anything outward-facing becomes an approval task for the human.

## Run

```
npm run focus                        # the terminal (or double-click Focus.command)
node focus/agents/momentum.mjs       # Agent 4 — follow-ups + stuck leads → tasks
node focus/agents/acquisitions.mjs   # Agent 1 — lead-engine shortlist → leads + review tasks
node focus/agents/underwriting.mjs   # Agent 2 — ARV → MAO/offer → "Send offer" tasks
node focus/agents/outreach.mjs       # Agent 3 — offer-ready leads → drafts + approval tasks
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
