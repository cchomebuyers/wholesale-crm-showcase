# DATA-MODEL.md — spec entities → live schema (Phase 2)

Ruling (approval gate): **persistence = existing SQLite (`crm.db`) via API**, not
localStorage. The spec's model maps onto live tables additively — new columns are
`ws_`-prefixed or defaulted; nothing existing changes shape. Server adapter:
`workspace_api.mjs` (mounted in server.js, all routes under `/api/ws/*`).

## Entity map

| Spec entity | Lives in | Notes |
|---|---|---|
| `Lead` | `leads` | `motivationScore` → new `ws_motivation_score` (1-5, default 3) · `nextFollowUpDate` → existing `next_followup` · `followUpCadenceDays` → per-type cadence in `settings.ws_cadence` (spec's +2/+1/+3 defaults, editable) · `reviveDate` → new `ws_revive_date` · `deletedAt` → new `ws_deleted_at` (30-day trash) · `stage` → **existing vocabulary kept**: New, Contacted, Follow-Up, Offer Made, Backup Offer, Under Contract, Assigned, Closed, Dead (superset of spec's; spec's `appointment`/`negotiating` fold into Follow-Up/Backup Offer) |
| `Property` | `leads` (inline) | The live schema stores property fields on the lead (`address/city/state/zip/property_type/arv/repair_estimate/...`). Kept — splitting the table would break 50 existing routes for zero UX gain. |
| `Buyer` | `buyers` | Existing table + new cols: `pof`, `closed_before`, `responsiveness` (1-5), `financing`, `deleted_at`. `buyBox` = `areas` + `property_types` (CSV) + `max_price` + `financing`. |
| `Deal` | **new `ws_deals`** | `contract_price, assignment_fee_target, emd, closing_date, title_company, assignment_clause_confirmed (BLOCKING — server rejects unless true), dispo_stage, locked_buyer_id, deleted_at`. Creating a deal advances the lead to Under Contract and mirrors contract_price onto it. |
| `Activity` | `activities` | Existing table; workspace types: `call_no_answer, call_spoke, offer_made, text, email, appointment, note` + existing `stage_change`. |
| MAO | **derived, never stored** | `(ARV × 0.70) − repairs − assignment fee target` — computed client-side per spec. (The `leads.mao` column predates the spec and stays untouched for the old UI/agents.) |

## API surface (`/api/ws/*`)

`GET state` (today list + revived + streak + cadence) · `POST log` (one-tap; auto-cadence)
· `POST clear-check` (streak) · `GET/POST leads`, `PATCH/DELETE leads/:id`,
`POST leads/:id/restore`, `GET trash` · `POST/GET deals`, `PATCH deals/:id`,
`GET deals/:id/matches`, `POST deals/:id/blast` · `GET/POST/PATCH/DELETE buyers`
· `GET analytics` · `GET/PUT settings` · `POST seed` (demo rows, tagged + removable).

## Guarantees
- Soft delete everywhere (leads/buyers/deals `deleted_at`), 30-day lead recovery via trash/restore.
- Ontario disclosure enforced server-side, not just in the modal.
- Old UI, Focus dashboard, and agents see the same rows — one substrate, three surfaces.
