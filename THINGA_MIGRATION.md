# Thinga-fying the Wholesale CRM
### *Collapsing every data structure and design choice in `server.js` onto the Ankhor substrate*

> **Source of truth:** `yearTwo777/synthesis/ANKHOR_ARCHITECTURE.md` — the Thinga is one recursive type, six axes, three operations (PUT/GET/INVOKE). `kind` is the manners; `schema` is enforcement when you need it; `category_path` is wayfinding; no hard deletes (tombstones). This doc applies §12 (the migration) to *this* codebase.
>
> ⚠️ **Scope honesty:** this is the same magnitude of change as the 5DEngine Ankhor collapse — architectural, multi-file, reversible only because of git. Per the 5DEngine **Rule 9** (architectural changes need explicit approval; `/loop` is for features, not silent re-architecture), this runs **on a branch**, behind an **interop layer that keeps the app working at every single iter** (axiom: *coherence before completion*). Nothing below is destructive until the legacy path is provably dead.

---

## 1. The central move — *one table under the eleven*

Today `crm.db` has eleven schemas: `leads, activities, buyers, settings, templates, tasks, campaigns, properties, notifications, emails, day_notes`. The Ankhor claim is that these are **eleven `kind`s of the same shape**. So the whole substrate becomes one table (same `node:sqlite` `DatabaseSync` already in use):

```sql
CREATE TABLE IF NOT EXISTS thingas (
  id            TEXT PRIMARY KEY,         -- "thinga:<uuid v4>"   (axis 1: identity)
  kind          TEXT NOT NULL,            -- lead|activity|buyer|task|campaign|property|message|note|setting|template|notification|code
  name          TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  content       TEXT,                     -- JSON                  (axis 2: content)
  axes          TEXT,                     -- JSON: tags, schema, color, icon, children[], parents[], links[],
                                          --       due_date, recurrence, ttl, code, owner, signature, checksum
                                          --                       (axes 3,4,5,6)
  category_path TEXT,                     -- "Pipeline/Offer Made" (axis 3: wayfinding, denormalized for index)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT                      -- soft delete only (tombstone), never DROP
);
CREATE INDEX IF NOT EXISTS idx_thinga_kind ON thingas(kind);
CREATE INDEX IF NOT EXISTS idx_thinga_path ON thingas(category_path);
-- reverse link index materialized from day one (5DEngine regret #6)
CREATE TABLE IF NOT EXISTS thinga_links (from_id TEXT, link_kind TEXT, to_id TEXT);
CREATE INDEX IF NOT EXISTS idx_links_to ON thinga_links(to_id);
```

## 2. The eleven tables → eleven `kind`s

| Current table | `kind` | content (axis 2) | relationships (axis 4) | time (axis 5) | code (axis 6) |
|---|---|---|---|---|---|
| `leads` | `lead` | seller, address, deal numbers, stage | `children`: its activities/emails/tasks; `links`: imported_from property | `next_followup`, created/updated | — |
| `activities` | `activity` | type, body | `parents`: [lead] | created | — |
| `emails` | `message` | subject, body, snippet, direction | `links`: `sent_to`/`received_from` lead | `msg_date` | — |
| `buyers` | `buyer` | name, buy-box, max_price | `links`: deals matched | created | — |
| `tasks` | `task` | title, done | `parents`: [lead] | `due_date` | — |
| `campaigns` | `campaign` | filters (city/price/beds…) | `children`: properties it found | `last_run`, `recurrence` (auto-scan!) | **the RentCast pull+filter** |
| `properties` | `property` | listing facts, scores, ARV/MAO | `links`: `imported_to` lead, `from` campaign | listed/removed dates | — |
| `notifications` | `notification` | title, body, read | `links`: `about` property | created | — |
| `day_notes` | `note` | body | `parents`: [calendar] | `due_date`=day | — |
| `settings` | `setting` / one `directive` | key→value | — | — | — |
| `templates` | `template` | subject, body w/ merge fields | audience tag | — | (render = a code Thinga) |

**The recursion already exists in the code:** a lead *has* activities, emails, tasks — that's `children`. A property *imports to* a lead — that's a `link`. An email *threads to* a lead via `leadByEmail` — that's a `links[].kind = sent_to`. We are not inventing structure; we are **naming the structure that's already implicit** and storing it uniformly.

## 3. The ~50 endpoints → PUT / GET / INVOKE

Every route in `server.js` is one of three primitives:

- **GET** — `/api/leads`, `/api/leads/:id`, `/api/prospects`, `/api/buyers`, `/api/campaigns`, `/api/properties`, `/api/stats`, `/api/offers`, `/api/inbox`, `/api/notifications`, `/api/templates`, `/api/tasks`, threads, comps. → `GET thinga:<id> [depth=N]` + `QUERY` (GET with a filter Thinga). `/api/stats` becomes a QUERY over `kind:lead` grouped by `category_path`.
- **PUT** — every create/update/delete: `POST/PUT/DELETE /api/leads`, buyers, templates, tasks, campaigns, day-notes, settings, triage, stage, collect-fee. → `PUT thinga:<json>` (validates `schema`, bumps `version`, re-signs, notifies subscribers). **DELETE becomes a tombstone PUT** (the current hard `DELETE FROM leads` → `deleted_at`; matches 5DEngine regret #7).
- **INVOKE** — every *verb* endpoint: `skiptrace`, `underwrite`, `analyze`, `ai`, `pull-violations`, `campaigns/:id/run`, `score-all`, `recompute`, `scan-crime`, `email`, `outreach`, `offer`, `backup`. → `INVOKE thinga:<code-id> <args>`.

## 4. The functions → code Thingas (the INVOKE registry)

Per Ankhor §4 (code and data are the same Thinga) and the **proven 5DEngine pattern** (`handlers.js` — code Thingas reference *registered native handlers by name*, no `eval`), each pure function in `server.js` becomes a `kind: code` Thinga whose `code.ref` points at a registered handler:

| Function today | code Thinga | invoked when |
|---|---|---|
| `scoreListing`, `computeUnderwrite`, `deriveAnalysis` | `code:score`, `code:underwrite` | on PUT of a `property`/`lead` (subscriber) |
| `detroitComps`, `pullBlightTickets`, `rentcastGet`, `countShootings30d` | `code:connector.*` | INVOKE — **this is the connector registry from `_scraping/`, realized as Thingas** |
| `collectContacts` + BatchData call | `code:skiptrace` | INVOKE on a `lead` |
| `buildDealPrompt` + Claude Opus 4.8 call | `code:ai-brief` | INVOKE on a `property` |
| `mergeFields` over a `template` | `code:render` | the **view is a Thinga whose code renders other Thingas** (§4.1 — MVC dissolves) |
| `runAutoScan`, `autoSyncInbox` timers | recurring `code` Thingas | `recurrence` axis fires them (no bespoke `setInterval`) |

The result: `server.js`'s split of "data in tables, logic in functions, queries in SQL" collapses into **one store, one validator, one sandbox, one sync, one signature** — exactly Ankhor §11.

## 5. The three memory layers (already half-built)

Ankhor §7.4 says the substrate's backbone is three container Thingas. The CRM already has them, unnamed:
- **Episodic** = `activities` + `emails` (every event logged raw) → `kind:activity`/`message` under an `episodic` container.
- **Deep** = scores, ARV, MAO, AI briefs (patterns derived from episodes) → live in each Thinga's `content`, indexed under `deep`.
- **Shared** = the cash-buyer list + deals blasted to buyers → `kind:buyer`/published `deal` Thingas under `shared`.

## 6. What an all-day loop actually produces (the iter plan)

Adapting the 5DEngine 5-phase cycle (Survey → Build → Prove → Ship → Respawn), **one concern per iter, commit `iter N: <concern>`**, on branch `thinga-substrate`, app green at every iter:

```
iter 1   Survey: freeze ankhor.v1 schema → docs/ankhor.v1.json + this doc
iter 2   Build: thinga.js runtime — PUT/GET/INVOKE over the `thingas` table (interop, app untouched)
iter 3   Prove: handler registry + soft-delete + reverse-link index + checksum/sign
iter 4   Migrate `leads`  → kind:lead  (adapter: existing /api/leads PUT/GETs Thingas underneath)
iter 5   Migrate `activities` + `emails` → activity/message as children/links of leads
iter 6   Migrate `tasks` + `day_notes` + `notifications`
iter 7   Migrate `buyers` + `templates` + `settings`
iter 8   Migrate `properties` + `campaigns` (campaign = code Thinga w/ recurrence)
iter 9   Convert verbs → INVOKE: score/underwrite/analyze as code Thingas + PUT subscribers
iter 10  Convert connectors → code:connector.* (folds in the _scraping registry)
iter 11  ai-brief + render + skiptrace as code Thingas
iter 12  Bridge: every /api/* endpoint is now a thin PUT/GET/INVOKE adapter
iter 13+ Via negativa: delete each bespoke table + function once its Thinga path is proven dead
         (the 2449→66 collapse, applied table by table)
```

**Stop conditions** (from the proven loop): a `docs/HALT` file exists, all eleven kinds migrated + legacy deleted, three consecutive `STUCK` iters, or you say stop. Each iter: real assertion (`node --test`) that the app still serves the same JSON before/after — parity, not vibes.

**Honest expectation:** the doc itself says this is *months, not weeks*. A full day of looping lands **iters 1–8 or so** — the runtime, the schema, and most tables Thinga-fied behind a working app — not the final deletion of legacy. But every iter is shippable and reversible, and the app never goes dark.

## 7. Why do it (the payoff, in this codebase's terms)
- **One sync/backup/export** instead of per-table — your `VACUUM INTO` backup and `leads.csv` export become *substrate-wide* for free.
- **Infinite new "types" without new schemas** — adding "crime score from SpotCrime," "fix-and-flip comps," "the research-agent fallback," all the per-country `rulesreg` data — each is a new `kind`, zero migrations.
- **The connector registry we designed in `_scraping/` IS the code-Thinga layer** — Thinga-fication and the multi-source lead pipeline are the *same work*.
- **The CRM becomes a citizen of the wider stack** — its leads, agents, and messages are Thingas that the 7D mesh can already route (`THE_STACK.md`), so this CRM stops being an island.

---

**Build it once. Compose it forever.** The substrate is already implied by `server.js`; this loop just makes it explicit, one reversible iter at a time.
