# Focus Terminal + Productivity Agents — Build Plan (handoff)

**For:** Fable 5 (or any executor). This plan is self-contained — every file path, schema,
SQL query, API contract, key binding, and house-style note you need is below. Do NOT re-explore;
the codebase facts are already verified with citations.

**Goal (from user):** Offload extensive real-estate workload onto agents so the user can focus,
plus an ADHD/concentration layer (a *visual terminal*) that keeps them on task and hitting daily KPIs.

**Runtime:** Node.js **22+** ESM (`package.json` has `"type":"module"`; the app uses `node:sqlite`
`DatabaseSync`, a Node 22 built-in). Everything below is dependency-free ANSI + `node:sqlite`.
`@anthropic-ai/sdk ^0.105.0` is already a dependency (use for the coach; degrade gracefully if no key).

---

## Verified codebase facts (cite these; don't re-discover)

- **Data lives in SQLite `crm.db`** at repo root, opened via `new DatabaseSync(join(__dirname,"crm.db"))`
  (`server.js:63`). Postgres is optional (KG only). Read `crm.db` directly so the terminal runs
  **standalone without the server**.
- **`tasks` table** (`server.js:112`): `id, lead_id, created_at, title, due_date, done`.
  CRUD API also exists: `GET /api/tasks` (`server.js:1176`), `POST /api/leads/:id/tasks` (`:1186`),
  `PUT /api/tasks/:id` (`:1198`).
- **`leads` table** (`server.js:79`) + migrations (`server.js:318`): key columns
  `id, created_at, updated_at, stage, seller_name, seller_phone, seller_email, address, city, state, zip,`
  `asking_price, arv, repair_estimate, offer_amount, contract_price, assignment_fee, mao, equity,`
  `opportunity_score, next_followup, source, motivation, notes, active (default 1), offer_sent_at,`
  `fee_collected, fee_collected_at, comps_json, arv_source, addr_canon, skiptraced_at`.
- **`call_outcomes` table** (`server.js:236`): `id, property_id, created_at, outcome, next_action,`
  `seller_price, offer_amount, follow_up_date, outreach_suppressed, notes`.
- **`properties` table** (`server.js:132`): scored inventory (lead_score, wholesale_score, arv, spread,
  owner_name/phone, review_status). This is the pre-lead funnel.
- **KPI source of truth = `GET /api/stats`** (`server.js:1763-1801`). Returns: `stages` (count/stage of
  `active=1` leads), `totals.pipeline_fees` (SUM assignment_fee of open leads), `totals.collected_fees`
  (SUM fee_collected of `stage='Closed'`), `followups` (leads `next_followup<=today`), `callFollowups`
  (latest `call_outcomes.follow_up_date<=today`, suppressed excluded), `offersToday`
  (`offer_sent_at >= cutoff9amET()`), and the ONLY existing daily goal: **`offersTarget: 5`** (`:1801`).
  `cutoff9amET()` = 9am America/New_York boundary (`server.js:1607`).
- **House TUI style = hand-rolled ANSI**, no libs. Reference renderer: `MatrixBoot` class,
  `crm-app.mjs:40-124` — uses `\x1b[38;5;<n>m` 256-color, `\x1b[?25l` hide cursor, `\x1b[2J` clear,
  `\x1b[y;xH` cursor move, green palette `[231,48,41,35,29,22]`. **Match this aesthetic.**
- **macOS launcher pattern** = `Wholesale CRM.command` (`#!/bin/bash`, `cd` to dir, add
  `/opt/homebrew/bin:/usr/local/bin` to PATH, then `node …`). Mirror it for `Focus.command`.
- **Existing agent/automation patterns:** in-process `setInterval` guarded by `safeTick(name,fn)`
  in `server.js` (inbox sync `:1504`, auto-scan `:2013`, lead-engine `:3344`, backups `:3563`);
  standalone loop script `councilRoom/tools/run-pi-agent-loop.mjs` (`--max-iterations`/`--sleep-ms`).
  The autonomous lead engine (`autonomous_lead_engine.js` + `lead_engine_scheduler.js`) already runs
  hourly. **Build new agents in these two shapes; do not invent a new scheduler.**
- **Connectors** (`connectors/index.js`): live = rentcast, detroit (blight+comps), census, county.js,
  socrata-phone, nyc/chicago licenses; gated = reso (token), batchdata-skiptrace (paid, off until
  `batchdata_api_key` setting). `contact_router.js` = compliant free→paid contact finder, marks
  `outreach_allowed:false` until DNC/consent clears. `route_engine.js` = generic route kernel.

---

## The 5 agents (answers "what 5 agents could we automate")

Each agent's OUTPUT is rows in `tasks` (+ lead field updates) so everything funnels into the Focus
Terminal. Agents never contact anyone or spend money autonomously — they queue an approval task.

### Agent 1 — Acquisitions Autopilot (Lead Intake & Enrichment)
- **Reuses:** `autonomous_lead_engine.js` (source → faceted_thinga → merge → score → shortlist),
  already scheduled hourly (`server.js:3344`).
- **Adds:** promote top-tier shortlist candidates into `leads` rows (`stage='New'`, address/financials
  filled, `active=1`), dedupe on `addr_canon`, and create a task `"Review new lead: {address}"`.
- **Compliance gate:** never sets contact-ready; leaves `outreach_allowed:false` semantics intact.
- **Entry:** `focus/agents/acquisitions.mjs` (standalone `node …` + optional server interval).

### Agent 2 — Underwriting Analyst (Comp / ARV / MAO / Offer)
- **Input:** leads/properties missing `arv`/`mao`. **Uses:** detroit comps connector + `properties`
  `price_history`, `@anthropic-ai/sdk` to reason over comps.
- **Writes:** `arv`, `repair_estimate`, `mao` (= ARV*0.70 − repair − target fee), `offer_amount`,
  `arv_source`, `comps_json` on the lead.
- **Output task:** `"Send offer on {address} — MAO ${mao}"` (due today).
- **Entry:** `focus/agents/underwriting.mjs`.

### Agent 3 — Compliant Outreach Drafter
- **Uses:** `contact_router.js` (free routes first, paid skiptrace only when gated) → checks
  DNC/consent → `outreach_allowed`. Drafts SMS/email/call script per lead from `templates` +
  `@anthropic-ai/sdk`. **Never auto-sends.**
- **Output task:** `"Approve & send outreach to {seller} — {phone/email}"` with the draft in notes.
- **Entry:** `focus/agents/outreach.mjs`.

### Agent 4 — Momentum Keeper (Pipeline & Follow-up)
- **Scans:** stale `next_followup`, overdue `call_outcomes.follow_up_date`, leads stuck in a stage too
  long (compare `updated_at`). Auto-creates/updates `tasks` with `due_date`; writes a daily digest.
- **Entry:** `focus/agents/momentum.mjs`.

### Agent 5 — Focus Coach (the ADHD daily-command brain) — **build this + the terminal first**
- Each morning reads `/api/stats` + open `tasks` + the queues from agents 1–4, ranks them into ONE
  ordered plan, picks the single **NEXT ACTION**, assigns timeboxes, feeds the terminal. Re-ranks when
  a task completes. Uses `@anthropic-ai/sdk` to turn raw rows into calm, small-step, one-thing-at-a-time
  guidance (degrade to a deterministic ranker if no `ANTHROPIC_API_KEY`).
- **Entry:** `focus/focus-coach.mjs`.

---

## The Focus Terminal (the visual thing — BUILD FIRST, ship before agents 1–4)

Dependency-free ANSI TUI, reads `crm.db` directly. This is the daily driver.

### Files
```
focus/
  focus-terminal.mjs     # entry: render loop + raw-keypress handling (the TUI)
  focus-data.mjs         # crm.db reader/writer: computeKpis, listTasks, toggleTask, addTask
  focus-coach.mjs        # ranking + next-action + timebox (Agent 5 logic; sdk optional)
  daily-goals.json       # editable KPI targets + focus settings (see below)
  focus-data.test.js     # node --test: KPI math + task toggle on a temp db
  AGENTS.md              # the 5-agent spec above, expanded
  PLAN.md                # this file
Focus.command            # repo root — double-click launcher, mirrors "Wholesale CRM.command"
```
Add to `package.json` scripts: `"focus": "node focus/focus-terminal.mjs"`.

### daily-goals.json (starting values — user edits freely)
```json
{
  "targets": { "newLeads": 25, "calls": 20, "offers": 5, "followupsCleared": "all", "stageAdvances": 5 },
  "focus":   { "pomodoroMin": 25, "breakMin": 5, "longBreakMin": 15, "cyclesBeforeLongBreak": 4 },
  "copy":    { "greetingAM": "Let's move. One thing at a time.", "streakEmoji": "🔥" }
}
```

### focus-data.mjs — crm.db access (node:sqlite)
- Open: `new DatabaseSync(join(ROOT,"crm.db"))`. For KPI reads, prefer read-only where possible; for
  task writes (toggle/add) open read-write briefly. Wrap writes in try/catch + one retry on `SQLITE_BUSY`
  (the server may hold the file).
- `todayStart()` → `new Date().toISOString().slice(0,10)` (date string); also implement `cutoff9amET()`
  copied from `server.js:1607` for offers parity.
- **Queries (match server.js semantics):**
  - `newLeadsToday`: `SELECT COUNT(*) n FROM leads WHERE created_at >= ?` (todayStart()).
  - `callsToday`: `SELECT COUNT(*) n FROM call_outcomes WHERE created_at >= ?` (todayStart()).
  - `offersToday`: `SELECT COUNT(*) n FROM leads WHERE offer_sent_at >= ?` (cutoff9amET()).
  - `stages`: `SELECT stage, COUNT(*) n FROM leads WHERE active=1 GROUP BY stage`.
  - `pipelineFees`: `SELECT COALESCE(SUM(assignment_fee),0) v FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')`.
  - `collectedFees`: `SELECT COALESCE(SUM(fee_collected),0) v FROM leads WHERE stage='Closed' AND fee_collected IS NOT NULL`.
  - `followupsDue`: leads `active=1 AND next_followup<=today AND stage NOT IN ('Closed','Dead')`
    UNION latest `call_outcomes.follow_up_date<=today` (suppressed excluded) — mirror `server.js:1773` & `:1785`.
  - `openTasks`: `SELECT t.id,t.title,t.due_date,t.done,l.address FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.done=0 ORDER BY t.due_date IS NULL, t.due_date ASC`.
  - `toggleTask(id)`: `UPDATE tasks SET done = 1-done WHERE id=?`.
  - `addTask(title)`: `INSERT INTO tasks (lead_id, created_at, title, due_date, done) VALUES (NULL, ?, ?, date('now'), 0)`.
- `computeKpis()` returns `{ newLeads:{done,target}, calls:{...}, offers:{done,target:5}, followups:{...},`
  `pipelineFees, collectedFees, stages }`.

### focus-terminal.mjs — the render (match MatrixBoot ANSI)
Full-screen redraw on 1s tick + on keypress. Panels top→bottom:
1. **Header:** `☥ FOCUS · {Weekday Mon D}` + streak (`🔥 N tasks done`) + clock. White-on-dark plate.
2. **NEXT ACTION** (big, boxed, bright): the single item from `focus-coach.getNextAction()`. This is the
   ADHD core — one thing, large, unavoidable.
3. **TASKS:** checkbox list (`[x]`/`[ ]`), due-today highlighted, `n/total done` + a progress bar.
4. **KPIs:** horizontal bars, `label ████████░░ 80%  40/50`, one per target in daily-goals.json
   (New leads, Calls, Offers /5, Follow-ups cleared, plus `$ pipeline` / `$ collected` as text).
   Bar helper: `const pct=Math.min(1,done/target); '█'.repeat(w*pct)+'░'.repeat(w-w*pct)`. Color by pct
   (red<0.4, yellow<0.8, green≥0.8 using 256-color codes 196/220/46).
5. **FOCUS TIMER:** Pomodoro MM:SS countdown + a draining bar; shows WORK/BREAK phase.
6. **AGENT QUEUE:** last run + count of approval tasks from agents 1–4 (read tasks whose title starts
   with "Review"/"Send offer"/"Approve & send"). Cheap: just filter openTasks.
7. **Footer keys.**
- **Keys** (raw mode: `process.stdin.setRawMode(true); setEncoding('utf8'); on('data')`):
  `space` toggle highlighted task · `↑/↓` or `j/k` move selection · `n` brain-dump (prompt one line,
  `addTask`) · `f` start/pause focus timer · `r` refresh · `q`/Ctrl-C quit (restore cursor `\x1b[?25h`,
  clear, `setRawMode(false)`).
- **Non-TTY fallback:** if `!process.stdout.isTTY`, print a plain one-shot digest (KPIs + next action +
  open task count) and exit 0 — so it's cron/pipe safe.
- **Robustness:** never crash on a locked db — catch, show "⟳ db busy" and retry next tick.

### Focus.command (repo root)
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$DIR"
exec node "$DIR/focus/focus-terminal.mjs" "$@"
```
`chmod +x "Focus.command"`. (Repo forces LF on `.command` via `.gitattributes` — keep LF.)

---

## ADHD/focus design principles to bake in (not decoration — the point)
- **One next action, big.** Never make the user choose from a wall. The coach decides; the terminal shows one.
- **Timeboxing** (Pomodoro) with a visible draining bar = external time-sense.
- **Brain-dump capture** (`n`) so a stray thought never derails focus — it's parked instantly.
- **Momentum/streak** + green progress = dopamine on completion.
- **Small steps:** the coach splits big tasks ("Call 20 sellers" → "Call the next 1").
- **Minimal choices, calm copy.** Fewer colors than Matrix; steady, not frantic.

---

## Build order (ship runnable at each step — CLAUDE.md rule 5: app stays runnable, `npm test` green)
1. `focus/daily-goals.json` + `focus/focus-data.mjs` + `focus/focus-data.test.js` → `npm test` green.
2. `focus/focus-coach.mjs` (deterministic ranker first; sdk enrichment behind `ANTHROPIC_API_KEY` guard).
3. `focus/focus-terminal.mjs` + `Focus.command` + `package.json` `"focus"` script → run it, verify panels.
4. `focus/AGENTS.md` (expand the 5-agent spec).
5. Agents 1–4 in `focus/agents/*.mjs`, each standalone-runnable, each writing `tasks`. Wire into
   `server.js` `safeTick`/`setInterval` only after each runs clean standalone.
6. Commit, push branch, open a draft PR (`gh pr create --draft`). Never push main.

## Test / verify
- `npm test` (node --test) must stay green; the new test seeds a temp `crm.db`, inserts leads/tasks/
  call_outcomes, asserts `computeKpis()` numbers and `toggleTask`/`addTask`.
- Manually: `node focus/focus-terminal.mjs` against the real `crm.db` (mtime shows it's live).
- Non-TTY: `node focus/focus-terminal.mjs | cat` prints the digest and exits.

## Gotchas
- Node **22+** required (`node:sqlite`). If `node -v` < 22, print a clear message and exit.
- `crm.db` is written by the running server — always read tolerantly, retry on `SQLITE_BUSY`.
- Keep `.command` files LF-only (`.gitattributes` enforces; don't let an editor rewrite to CRLF).
- Don't touch `superCharged/` graph nodes — that's the continuity system with its own reading contract.
