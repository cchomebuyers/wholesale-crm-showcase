// ============================================================================
// workspace_api.mjs — data adapter for the merged Workspace (spec Phase 2)
// ============================================================================
// Maps the spec's Lead/Property/Buyer/Deal/Activity model onto the LIVE
// schema (see DATA-MODEL.md). Everything here is additive: new columns are
// ws_-prefixed or defaulted, all routes live under /api/ws/*, and no existing
// route or table shape changes. Mounted by server.js: mountWorkspace(app).
// MAO is DERIVED (ARV×0.70 − repairs − fee), computed client-side, never stored.

import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// One-tap cadence defaults (spec Phase 3), editable via /api/ws/settings.
const DEFAULT_CADENCE = { call_no_answer: 2, call_spoke: 1, offer_made: 3 };
const ONE_TAP = new Set(Object.keys(DEFAULT_CADENCE));
const ACTIVITY_TYPES = new Set([...ONE_TAP, "text", "email", "appointment", "note"]);
export const WS_STAGES = ["New", "Contacted", "Follow-Up", "Offer Made", "Backup Offer", "Under Contract", "Assigned", "Closed", "Dead"];

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

export function mountWorkspace(app, { dbPath = join(__dirname, "crm.db") } = {}) {
  const db = new DatabaseSync(dbPath);
  try { db.exec("PRAGMA busy_timeout = 250"); } catch { /* older sqlite */ }

  // ---- additive migrations (idempotent) -----------------------------------
  for (const col of ["ws_deleted_at TEXT", "ws_revive_date TEXT", "ws_motivation_score INTEGER"]) {
    try { db.exec(`ALTER TABLE leads ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  for (const col of ["pof INTEGER DEFAULT 0", "closed_before INTEGER DEFAULT 0", "responsiveness INTEGER DEFAULT 3", "financing TEXT", "deleted_at TEXT"]) {
    try { db.exec(`ALTER TABLE buyers ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ws_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    contract_price REAL, assignment_fee_target REAL, emd REAL,
    closing_date TEXT, title_company TEXT,
    assignment_clause_confirmed INTEGER NOT NULL,  -- Ontario disclosure: blocking
    dispo_stage TEXT NOT NULL DEFAULT 'blast_sent',
    locked_buyer_id INTEGER
  )`);

  // Do-Today manual ordering (dashboard) — additive, null = unordered
  try { db.exec("ALTER TABLE tasks ADD COLUMN position INTEGER"); } catch { /* exists */ }

  const getSetting = (k, fb = null) => { try { return db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? fb; } catch { return fb; } };
  const setSetting = (k, v) => db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
  const cadence = () => { try { return { ...DEFAULT_CADENCE, ...JSON.parse(getSetting("ws_cadence", "{}")) }; } catch { return { ...DEFAULT_CADENCE }; } };
  const logActivity = (leadId, type, body) => db.prepare("INSERT INTO activities (lead_id, created_at, type, body) VALUES (?,?,?,?)").run(leadId, now(), type, body);
  const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const LEAD_COLS = `id, seller_name, seller_phone, seller_email, address, city, state, zip,
    property_type, stage, motivation, ws_motivation_score, source, next_followup,
    asking_price, arv, repair_estimate, assignment_fee, offer_amount, contract_price,
    created_at, updated_at, ws_revive_date, ws_deleted_at`;
  const live = "active=1 AND ws_deleted_at IS NULL";

  // ---- Phase 3: Today ------------------------------------------------------
  app.get("/api/ws/state", (req, res) => {
    const t = today();
    const due = db.prepare(`SELECT ${LEAD_COLS} FROM leads
      WHERE ${live} AND stage NOT IN ('Closed','Dead')
        AND next_followup IS NOT NULL AND next_followup <= ?
      ORDER BY COALESCE(ws_motivation_score,3) DESC, next_followup ASC LIMIT 20`).all(t);
    const revived = db.prepare(`SELECT ${LEAD_COLS} FROM leads
      WHERE ${live} AND stage='Dead' AND ws_revive_date IS NOT NULL AND ws_revive_date <= ?
      ORDER BY ws_revive_date ASC LIMIT 10`).all(t);
    res.json({
      today: t, due, revived,
      streak: +(getSetting("ws_streak", "0") || 0),
      cadence: cadence(),
    });
  });

  // one-tap logging: records the Activity AND auto-schedules the next follow-up
  app.post("/api/ws/log", (req, res) => {
    const { lead_id, type, detail } = req.body || {};
    if (!lead_id || !ACTIVITY_TYPES.has(type)) return res.status(400).json({ error: "lead_id + valid type required" });
    const lead = db.prepare("SELECT id, stage FROM leads WHERE id=?").get(lead_id);
    if (!lead) return res.status(404).json({ error: "no such lead" });
    logActivity(lead_id, type, detail || `ws one-tap: ${type.replace(/_/g, " ")}`);
    let nextFollowup = null;
    if (ONE_TAP.has(type)) {
      nextFollowup = plusDays(cadence()[type]);
      db.prepare("UPDATE leads SET next_followup=?, updated_at=? WHERE id=?").run(nextFollowup, now(), lead_id);
    }
    if (type === "offer_made" && lead.stage !== "Offer Made") {
      db.prepare("UPDATE leads SET stage='Offer Made', offer_sent_at=COALESCE(offer_sent_at, ?), updated_at=? WHERE id=?").run(now(), now(), lead_id);
      logActivity(lead_id, "stage_change", `Stage: ${lead.stage} → Offer Made`);
    }
    res.json({ ok: true, next_followup: nextFollowup });
  });

  // streak: consecutive days where the Today list was fully cleared
  app.post("/api/ws/clear-check", (req, res) => {
    const t = today();
    const remaining = db.prepare(`SELECT COUNT(*) n FROM leads WHERE ${live}
      AND stage NOT IN ('Closed','Dead') AND next_followup IS NOT NULL AND next_followup <= ?`).get(t).n;
    if (remaining > 0) return res.json({ cleared: false, streak: +(getSetting("ws_streak", "0") || 0) });
    const last = getSetting("ws_last_clear", "");
    let streak = +(getSetting("ws_streak", "0") || 0);
    if (last !== t) {
      streak = last === plusDays(-1) ? streak + 1 : 1;
      setSetting("ws_streak", streak);
      setSetting("ws_last_clear", t);
    }
    res.json({ cleared: true, streak, firstClearToday: last !== t });
  });

  // ---- Today dashboard (single-screen command center) ----------------------
  // One call feeds every panel: KPI strip, Do Today, Alerts, Email, News,
  // briefing status. Live SQL for freshness; news + briefing come from the
  // caches their scheduled jobs maintain (settings: daily_news, briefing_state).
  const safeAll = (sql, params = [], fb = []) => { try { return db.prepare(sql).all(...params); } catch { return fb; } };
  const safeGet = (sql, params = [], fb = null) => { try { return db.prepare(sql).get(...params) ?? fb; } catch { return fb; } };

  // 9am-ET offer-day cutoff — mirrors server.js /api/stats semantics
  function cutoff9amET(nowD = new Date()) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nowD);
    const g = (t) => +p.find((x) => x.type === t).value;
    const et = new Date(nowD.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const utc = new Date(nowD.toLocaleString("en-US", { timeZone: "UTC" }));
    const offUTC = -Math.round((et - utc) / 60000);
    let cutoff = new Date(Date.UTC(g("year"), g("month") - 1, g("day"), 9, 0, 0) + offUTC * 60000);
    if (nowD < cutoff) cutoff = new Date(cutoff.getTime() - 86400000);
    return cutoff.toISOString();
  }

  app.get("/api/ws/dashboard", (req, res) => {
    const t = today();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const in72h = plusDays(3);

    // --- KPI strip ---
    const kpis = {
      newLeadsToday: safeGet("SELECT COUNT(*) n FROM leads WHERE created_at >= ?", [t], { n: 0 }).n,
      newLeadsWeek: safeGet("SELECT COUNT(*) n FROM leads WHERE created_at >= ?", [weekAgo], { n: 0 }).n,
      contracts: safeGet("SELECT COUNT(*) n FROM ws_deals WHERE deleted_at IS NULL AND dispo_stage != 'closed'", [], { n: 0 }).n,
      pipelineValue: safeGet("SELECT COALESCE(SUM(assignment_fee),0) v FROM leads WHERE active=1 AND stage NOT IN ('Closed','Dead')", [], { v: 0 }).v,
      offersToday: safeGet("SELECT COUNT(*) n FROM leads WHERE offer_sent_at >= ?", [cutoff9amET()], { n: 0 }).n,
      followupsDue: safeGet(`SELECT COUNT(*) n FROM leads WHERE ${live} AND stage NOT IN ('Closed','Dead')
        AND next_followup IS NOT NULL AND next_followup <= ?`, [t], { n: 0 }).n,
      followupsOverdue: safeGet(`SELECT COUNT(*) n FROM leads WHERE ${live} AND stage NOT IN ('Closed','Dead')
        AND next_followup IS NOT NULL AND next_followup < ?`, [t], { n: 0 }).n,
      buyers: safeGet("SELECT COUNT(*) n FROM buyers WHERE deleted_at IS NULL", [], { n: 0 }).n,
      buyersNewWeek: safeGet("SELECT COUNT(*) n FROM buyers WHERE deleted_at IS NULL AND created_at >= ?", [weekAgo], { n: 0 }).n,
      collectedFees: safeGet("SELECT COALESCE(SUM(fee_collected),0) v FROM leads WHERE stage='Closed' AND fee_collected IS NOT NULL", [], { v: 0 }).v,
      offersTarget: 5,
    };
    const sent7 = safeGet("SELECT COUNT(*) n FROM emails WHERE direction='out' AND msg_date >= ?", [weekAgo], { n: 0 }).n;
    const replies7 = safeGet("SELECT COUNT(*) n FROM emails WHERE direction='in' AND lead_id IS NOT NULL AND msg_date >= ?", [weekAgo], { n: 0 }).n;
    kpis.responseRate = sent7 ? Math.round((replies7 / sent7) * 100) : null;
    kpis.outbound7 = sent7; kpis.replies7 = replies7;

    // --- Do Today (tasks + follow-ups + revived + closings) ---
    const doToday = [];
    for (const x of safeAll(`SELECT t.id, t.title, t.due_date, t.position, t.lead_id, l.address
        FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id
        WHERE t.done=0 AND (t.due_date IS NULL OR t.due_date <= ?)
        ORDER BY t.position IS NULL, t.position ASC, t.due_date ASC, t.id ASC LIMIT 60`, [t])) {
      doToday.push({ kind: "task", taskId: x.id, leadId: x.lead_id, title: x.title, sub: x.address || null,
        overdue: Boolean(x.due_date && x.due_date < t), position: x.position });
    }
    for (const f of safeAll(`SELECT id, seller_name, address, stage, next_followup, seller_phone FROM leads
        WHERE ${live} AND stage NOT IN ('Closed','Dead') AND next_followup IS NOT NULL AND next_followup <= ?
        ORDER BY next_followup ASC LIMIT 30`, [t])) {
      doToday.push({ kind: "followup", leadId: f.id, title: `Follow up: ${f.seller_name || "seller"} — ${f.address || "lead #" + f.id}`,
        sub: `${f.stage}${f.seller_phone ? " · " + f.seller_phone : ""}`, overdue: f.next_followup < t });
    }
    for (const r of safeAll(`SELECT id, seller_name, address FROM leads
        WHERE ${live} AND stage='Dead' AND ws_revive_date IS NOT NULL AND ws_revive_date <= ? LIMIT 10`, [t])) {
      doToday.push({ kind: "revived", leadId: r.id, title: `Revive: ${r.address || r.seller_name || "lead #" + r.id}`, sub: "call today", overdue: true });
    }
    for (const d of safeAll(`SELECT d.id, d.closing_date, l.id lead_id, l.address FROM ws_deals d
        JOIN leads l ON l.id=d.lead_id
        WHERE d.deleted_at IS NULL AND d.dispo_stage != 'closed' AND d.closing_date IS NOT NULL AND d.closing_date <= ?`, [in72h])) {
      doToday.push({ kind: "closing", dealId: d.id, leadId: d.lead_id, title: `Closing ${d.closing_date}: ${d.address || "deal #" + d.id}`,
        sub: "push to close", overdue: d.closing_date <= t });
    }
    doToday.sort((a, b) => (b.overdue - a.overdue) || ((a.position ?? 1e9) - (b.position ?? 1e9)));

    // --- Alerts (red = act now, yellow = drifting) ---
    const alerts = [];
    for (const d of safeAll(`SELECT d.id, d.closing_date, l.id lead_id, l.address FROM ws_deals d JOIN leads l ON l.id=d.lead_id
        WHERE d.deleted_at IS NULL AND d.dispo_stage != 'closed' AND d.closing_date IS NOT NULL AND d.closing_date <= ?`, [in72h])) {
      alerts.push({ severity: "red", kind: "closing", dealId: d.id, leadId: d.lead_id, view: "dispo",
        text: `Contract ${d.address || "#" + d.id} closes ${d.closing_date}` });
    }
    for (const e of safeAll(`SELECT e.lead_id, MAX(e.msg_date) last_in, l.address, l.seller_name FROM emails e
        JOIN leads l ON l.id=e.lead_id WHERE e.direction='in' AND e.lead_id IS NOT NULL
        GROUP BY e.lead_id
        HAVING NOT EXISTS (SELECT 1 FROM emails o WHERE o.lead_id=e.lead_id AND o.direction='out' AND o.msg_date > MAX(e.msg_date))
        ORDER BY last_in DESC LIMIT 10`)) {
      const ageH = (Date.now() - Date.parse(e.last_in)) / 3600000;
      alerts.push({ severity: ageH > 24 ? "red" : "yellow", kind: "unanswered", leadId: e.lead_id, view: "acquisitions",
        text: `${e.seller_name || e.address || "lead #" + e.lead_id} replied ${Math.round(ageH)}h ago — no answer sent` });
    }
    for (const f of safeAll(`SELECT id, seller_name, address, next_followup FROM leads
        WHERE ${live} AND stage NOT IN ('Closed','Dead') AND next_followup IS NOT NULL AND next_followup < ?
        ORDER BY next_followup ASC LIMIT 10`, [t])) {
      alerts.push({ severity: "red", kind: "missed_followup", leadId: f.id, view: "acquisitions",
        text: `Missed follow-up (${f.next_followup}): ${f.seller_name || f.address || "#" + f.id}` });
    }
    const stale = new Date(Date.now() - 5 * 86400000).toISOString();
    for (const s of safeAll(`SELECT id, address, seller_name, stage, updated_at FROM leads
        WHERE ${live} AND stage IN ('Contacted','Follow-Up','Offer Made','Backup Offer','Under Contract','Assigned')
        AND updated_at < ? ORDER BY updated_at ASC LIMIT 10`, [stale])) {
      alerts.push({ severity: "yellow", kind: "stalled", leadId: s.id, view: "acquisitions",
        text: `Stalled ${Math.floor((Date.now() - Date.parse(s.updated_at)) / 86400000)}d in ${s.stage}: ${s.address || s.seller_name || "#" + s.id}` });
    }
    alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1));

    // --- Email feed ---
    const emails = safeAll(`SELECT e.id, e.lead_id, e.from_name, e.from_addr, e.subject, e.snippet, e.msg_date, e.read,
        l.address lead_address, l.seller_name FROM emails e LEFT JOIN leads l ON l.id=e.lead_id
        WHERE e.direction='in' ORDER BY e.msg_date DESC LIMIT 30`);
    const unread = safeGet("SELECT COUNT(*) n FROM emails WHERE direction='in' AND read=0", [], { n: 0 }).n;

    // --- 14-day series for KPI sparklines ---
    const dayList = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10));
    const fill = (rows) => { const m = Object.fromEntries(rows.map((r) => [r.d, r.n])); return dayList.map((d) => m[d] || 0); };
    const history = {
      newLeads: fill(safeAll("SELECT substr(created_at,1,10) d, COUNT(*) n FROM leads WHERE created_at >= ? GROUP BY d", [dayList[0]])),
      offers: fill(safeAll("SELECT substr(offer_sent_at,1,10) d, COUNT(*) n FROM leads WHERE offer_sent_at IS NOT NULL AND offer_sent_at >= ? GROUP BY d", [dayList[0]])),
      replies: fill(safeAll("SELECT substr(msg_date,1,10) d, COUNT(*) n FROM emails WHERE direction='in' AND lead_id IS NOT NULL AND msg_date >= ? GROUP BY d", [dayList[0]])),
    };

    // --- caches maintained by scheduled jobs ---
    let news = null, briefing = null;
    try { news = JSON.parse(getSetting("daily_news", "null")); } catch { /* bad cache */ }
    try { briefing = JSON.parse(getSetting("briefing_state", "null")); } catch { /* bad cache */ }

    res.json({ now: now(), today: t, kpis, history, doToday, alerts, emails, unread, news, briefing });
  });

  // Do-Today reorder: client sends the full ordered list of task ids
  app.post("/api/ws/tasks/reorder", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
    if (!ids || !ids.length) return res.status(400).json({ error: "ids[] required" });
    const stmt = db.prepare("UPDATE tasks SET position=? WHERE id=?");
    ids.forEach((id, i) => stmt.run(i, id));
    res.json({ ok: true, ordered: ids.length });
  });

  // AI reply drafter — sonny-voice.md rules + thread context. Graceful 400
  // when no Anthropic key is connected (panel shows plain compose instead).
  app.post("/api/ws/draft-reply", async (req, res) => {
    const email = safeGet("SELECT * FROM emails WHERE id=?", [Number(req.body?.email_id)]);
    if (!email) return res.status(404).json({ error: "no such email" });
    const apiKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "Connect AI (Acquisitions tab) to enable drafting." });
    try {
      const { readFileSync } = await import("node:fs");
      let voice = "";
      try { voice = readFileSync(join(__dirname, "sonny-voice.md"), "utf8"); } catch { /* defaults */ }
      const me = { name: getSetting("my_name", "Sonny"), phone: getSetting("my_phone", "") };
      const thread = email.lead_id
        ? safeAll("SELECT direction, subject, body, msg_date FROM emails WHERE lead_id=? ORDER BY msg_date DESC LIMIT 6", [email.lead_id])
        : [email];
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create(
        {
          model: "claude-opus-4-8",
          max_tokens: 800,
          thinking: { type: "adaptive" },
          system: `You draft email replies for Sonny, a Detroit real-estate wholesaler. Follow these style rules exactly:\n\n${voice}\n\nSonny's name: ${me.name}. Phone: ${me.phone}. Return ONLY the email body text — no subject line, no commentary.`,
          messages: [{ role: "user", content: `Reply to this (newest first thread):\n${JSON.stringify(thread)}` }],
        },
        { timeout: 45_000, maxRetries: 1 },
      );
      const draft = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      res.json({ ok: true, draft });
    } catch (e) { res.status(502).json({ error: "Draft failed: " + e.message }); }
  });

  // ---- Phase 4: leads / kanban --------------------------------------------
  app.get("/api/ws/leads", (req, res) => {
    const rows = db.prepare(`SELECT ${LEAD_COLS} FROM leads WHERE ${live} ORDER BY updated_at DESC LIMIT 500`).all();
    res.json({ stages: WS_STAGES, leads: rows });
  });

  app.post("/api/ws/leads", (req, res) => {
    const b = req.body || {};
    if (!b.address && !b.seller_name) return res.status(400).json({ error: "address or seller_name required" });
    const info = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, seller_name, seller_phone, seller_email,
      address, city, state, zip, motivation, ws_motivation_score, source, asking_price, active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      now(), now(), "New", b.seller_name ?? null, b.seller_phone ?? null, b.seller_email ?? null,
      b.address ?? null, b.city ?? null, b.state ?? null, b.zip ?? null,
      b.motivation ?? null, b.ws_motivation_score ?? 3, b.source ?? "quick_capture", b.asking_price ?? null);
    const id = Number(info.lastInsertRowid);
    logActivity(id, "note", "created via workspace quick capture");
    res.json({ ok: true, id });
  });

  const PATCHABLE = new Set(["stage", "seller_name", "seller_phone", "seller_email", "address", "city", "state", "zip",
    "motivation", "ws_motivation_score", "source", "asking_price", "arv", "repair_estimate", "assignment_fee",
    "next_followup", "ws_revive_date", "property_type"]);
  app.patch("/api/ws/leads/:id", (req, res) => {
    const lead = db.prepare("SELECT id, stage FROM leads WHERE id=?").get(+req.params.id);
    if (!lead) return res.status(404).json({ error: "no such lead" });
    const b = req.body || {};
    if (b.stage && !WS_STAGES.includes(b.stage)) return res.status(400).json({ error: "unknown stage" });
    // dead leads require a revive date (spec Phase 4)
    if (b.stage === "Dead" && !b.ws_revive_date) return res.status(400).json({ error: "revive date required to kill a lead" });
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(b)) {
      if (!PATCHABLE.has(k)) continue;
      sets.push(`${k}=?`); vals.push(v === "" ? null : v);
    }
    if (!sets.length) return res.status(400).json({ error: "nothing to update" });
    db.prepare(`UPDATE leads SET ${sets.join(",")}, updated_at=? WHERE id=?`).run(...vals, now(), lead.id);
    if (b.stage && b.stage !== lead.stage) logActivity(lead.id, "stage_change", `Stage: ${lead.stage} → ${b.stage}`);
    res.json({ ok: true });
  });

  // soft delete + 30-day recovery (spec non-negotiable)
  app.delete("/api/ws/leads/:id", (req, res) => {
    db.prepare("UPDATE leads SET ws_deleted_at=?, active=0, updated_at=? WHERE id=?").run(now(), now(), +req.params.id);
    res.json({ ok: true, recoverableFor: "30 days" });
  });
  app.post("/api/ws/leads/:id/restore", (req, res) => {
    db.prepare("UPDATE leads SET ws_deleted_at=NULL, active=1, updated_at=? WHERE id=?").run(now(), +req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/ws/trash", (req, res) => {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    res.json(db.prepare(`SELECT id, address, seller_name, stage, ws_deleted_at FROM leads
      WHERE ws_deleted_at IS NOT NULL AND ws_deleted_at >= ? ORDER BY ws_deleted_at DESC`).all(cutoff));
  });

  // ---- Phase 4→5 bridge: Deals (Under Contract) ----------------------------
  // The Ontario assignment-disclosure checkbox is BLOCKING: a deal cannot be
  // created unless assignment_clause_confirmed is explicitly true.
  app.post("/api/ws/deals", (req, res) => {
    const b = req.body || {};
    if (!b.lead_id) return res.status(400).json({ error: "lead_id required" });
    if (b.assignment_clause_confirmed !== true) {
      return res.status(400).json({ error: "assignment clause disclosure must be confirmed before saving (Ontario)" });
    }
    const lead = db.prepare("SELECT id, stage FROM leads WHERE id=?").get(b.lead_id);
    if (!lead) return res.status(404).json({ error: "no such lead" });
    const info = db.prepare(`INSERT INTO ws_deals (lead_id, created_at, updated_at, contract_price,
      assignment_fee_target, emd, closing_date, title_company, assignment_clause_confirmed)
      VALUES (?,?,?,?,?,?,?,?,1)`).run(
      b.lead_id, now(), now(), b.contract_price ?? null, b.assignment_fee_target ?? null,
      b.emd ?? null, b.closing_date ?? null, b.title_company ?? null);
    db.prepare("UPDATE leads SET stage='Under Contract', contract_price=?, assignment_fee=COALESCE(?, assignment_fee), updated_at=? WHERE id=?")
      .run(b.contract_price ?? null, b.assignment_fee_target ?? null, now(), b.lead_id);
    if (lead.stage !== "Under Contract") logActivity(b.lead_id, "stage_change", `Stage: ${lead.stage} → Under Contract`);
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  app.get("/api/ws/deals", (req, res) => {
    const rows = db.prepare(`SELECT d.*, l.address, l.city, l.property_type, l.seller_name FROM ws_deals d
      JOIN leads l ON l.id=d.lead_id WHERE d.deleted_at IS NULL AND d.dispo_stage != 'dead'
      ORDER BY d.updated_at DESC`).all();
    for (const r of rows) {
      r.days_to_close = r.closing_date ? Math.ceil((Date.parse(r.closing_date) - Date.now()) / 86400000) : null;
    }
    res.json(rows);
  });

  const DISPO = ["blast_sent", "showings", "offers_in", "buyer_locked", "closing", "closed", "dead"];
  app.patch("/api/ws/deals/:id", (req, res) => {
    const deal = db.prepare("SELECT * FROM ws_deals WHERE id=?").get(+req.params.id);
    if (!deal) return res.status(404).json({ error: "no such deal" });
    const b = req.body || {};
    if (b.dispo_stage && !DISPO.includes(b.dispo_stage)) return res.status(400).json({ error: "unknown dispo stage" });
    const sets = [], vals = [];
    for (const k of ["dispo_stage", "locked_buyer_id", "contract_price", "assignment_fee_target", "emd", "closing_date", "title_company"]) {
      if (k in b) { sets.push(`${k}=?`); vals.push(b[k] === "" ? null : b[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: "nothing to update" });
    db.prepare(`UPDATE ws_deals SET ${sets.join(",")}, updated_at=? WHERE id=?`).run(...vals, now(), deal.id);
    if (b.dispo_stage === "closed") db.prepare("UPDATE leads SET stage='Closed', updated_at=? WHERE id=?").run(now(), deal.lead_id);
    res.json({ ok: true });
  });

  // ---- Phase 5: buyer matching ---------------------------------------------
  // Score every buyer against the buy box: area + type + (price+fee ≤ max).
  // Rank: responsiveness × (PoF 1.5×) × (closed-before 1.3×).
  function matchBuyers(deal) {
    const lead = db.prepare("SELECT city, state, zip, address, property_type FROM leads WHERE id=?").get(deal.lead_id) || {};
    const price = (deal.contract_price || 0) + (deal.assignment_fee_target || 0);
    const hay = `${lead.city || ""} ${lead.state || ""} ${lead.zip || ""} ${lead.address || ""}`.toLowerCase();
    const rows = db.prepare("SELECT * FROM buyers WHERE deleted_at IS NULL").all();
    const scored = [];
    for (const b of rows) {
      const areas = String(b.areas || "").toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      const types = String(b.property_types || "").toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      const areaMatch = !areas.length || areas.some((a) => hay.includes(a));
      const typeMatch = !types.length || (lead.property_type && types.some((t) => String(lead.property_type).toLowerCase().includes(t)));
      const priceOk = !b.max_price || price <= b.max_price;
      if (!(areaMatch && typeMatch && priceOk)) continue;
      const weight = (b.responsiveness || 3) * (b.pof ? 1.5 : 1) * (b.closed_before ? 1.3 : 1);
      scored.push({ ...b, match: { areaMatch, typeMatch, priceOk, weight: +weight.toFixed(2) } });
    }
    return scored.sort((a, z) => z.match.weight - a.match.weight);
  }
  app.get("/api/ws/deals/:id/matches", (req, res) => {
    const deal = db.prepare("SELECT * FROM ws_deals WHERE id=?").get(+req.params.id);
    if (!deal) return res.status(404).json({ error: "no such deal" });
    res.json(matchBuyers(deal));
  });
  app.post("/api/ws/deals/:id/blast", (req, res) => {
    const deal = db.prepare("SELECT * FROM ws_deals WHERE id=?").get(+req.params.id);
    if (!deal) return res.status(404).json({ error: "no such deal" });
    const matched = matchBuyers(deal);
    for (const b of matched) logActivity(deal.lead_id, "email", `ws blast → buyer ${b.name || b.id} (deal ${deal.id})`);
    db.prepare("UPDATE ws_deals SET dispo_stage='blast_sent', updated_at=? WHERE id=?").run(now(), deal.id);
    res.json({ ok: true, blasted: matched.length });
  });

  // ---- Phase 6: buyers -------------------------------------------------------
  app.get("/api/ws/buyers", (req, res) => {
    res.json(db.prepare("SELECT * FROM buyers WHERE deleted_at IS NULL ORDER BY responsiveness DESC, name ASC LIMIT 200").all());
  });
  app.post("/api/ws/buyers", (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name required" });
    const info = db.prepare(`INSERT INTO buyers (created_at, name, phone, email, areas, property_types, max_price, cash, notes, pof, closed_before, responsiveness, financing)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      now(), b.name, b.phone ?? null, b.email ?? null, b.areas ?? null, b.property_types ?? null,
      b.max_price ?? null, b.cash ?? 1, b.notes ?? null, b.pof ? 1 : 0, b.closed_before ? 1 : 0,
      b.responsiveness ?? 3, b.financing ?? "cash");
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });
  app.patch("/api/ws/buyers/:id", (req, res) => {
    const cur = db.prepare("SELECT id FROM buyers WHERE id=?").get(+req.params.id);
    if (!cur) return res.status(404).json({ error: "no such buyer" });
    const sets = [], vals = [];
    for (const k of ["name", "phone", "email", "areas", "property_types", "max_price", "cash", "notes", "pof", "closed_before", "responsiveness", "financing"]) {
      if (k in (req.body || {})) { sets.push(`${k}=?`); vals.push(req.body[k] === "" ? null : req.body[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: "nothing to update" });
    db.prepare(`UPDATE buyers SET ${sets.join(",")} WHERE id=?`).run(...vals, cur.id);
    res.json({ ok: true });
  });
  app.delete("/api/ws/buyers/:id", (req, res) => {
    db.prepare("UPDATE buyers SET deleted_at=? WHERE id=?").run(now(), +req.params.id);
    res.json({ ok: true });
  });

  // ---- Phase 8: analytics (4 numbers + leads by source, nothing more) -------
  app.get("/api/ws/analytics", (req, res) => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    res.json({
      contactedThisWeek: db.prepare(`SELECT COUNT(DISTINCT lead_id) n FROM activities
        WHERE created_at >= ? AND type IN ('call_no_answer','call_spoke','text','email')`).get(weekAgo).n,
      offersMade: db.prepare("SELECT COUNT(*) n FROM leads WHERE offer_sent_at >= ?").get(weekAgo).n,
      underContract: db.prepare("SELECT COUNT(*) n FROM ws_deals WHERE deleted_at IS NULL AND dispo_stage NOT IN ('closed','dead')").get().n,
      projectedFees: db.prepare(`SELECT COALESCE(SUM(COALESCE(d.assignment_fee_target, l.assignment_fee)),0) v
        FROM ws_deals d JOIN leads l ON l.id=d.lead_id
        WHERE d.deleted_at IS NULL AND d.dispo_stage NOT IN ('closed','dead')`).get().v,
      bySource: db.prepare(`SELECT COALESCE(source,'unknown') source, COUNT(*) n FROM leads
        WHERE ${live} GROUP BY COALESCE(source,'unknown') ORDER BY n DESC LIMIT 8`).all(),
    });
  });

  // ---- settings (cadence editable, spec Phase 3) -----------------------------
  app.get("/api/ws/settings", (req, res) => res.json({ cadence: cadence(), streak: +(getSetting("ws_streak", "0") || 0) }));
  app.put("/api/ws/settings", (req, res) => {
    const c = req.body?.cadence;
    if (c && typeof c === "object") setSetting("ws_cadence", JSON.stringify(c));
    res.json({ ok: true, cadence: cadence() });
  });

  // ---- seed-data toggle for demos (spec Phase 9) -----------------------------
  app.post("/api/ws/seed", (req, res) => {
    if (req.body?.on) {
      const L = db.prepare(`INSERT INTO leads (created_at, updated_at, stage, seller_name, seller_phone, address, city, state, zip,
        property_type, motivation, ws_motivation_score, source, asking_price, arv, repair_estimate, assignment_fee, next_followup, active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
      const t = today();
      const demo = [
        ["Dana Demo", "313-555-0000", "100 Demo St", "Detroit", "MI", "48201", "single_family", "tired_landlord", 5, "ws-demo", 60000, 120000, 15000, 10000, t],
        ["Sam Sample", "313-555-0001", "200 Sample Ave", "Detroit", "MI", "48202", "duplex", "probate", 4, "ws-demo", 80000, 150000, 25000, 12000, t],
        ["Pat Placeholder", null, "300 Placeholder Rd", "Warren", "MI", "48088", "single_family", "preforeclosure", 3, "ws-demo", 90000, 140000, 20000, 10000, null],
      ];
      for (const d of demo) L.run(now(), now(), "New", ...d.slice(0, 9), d[9], d[10], d[11], d[12], d[13], d[14]);
      db.prepare(`INSERT INTO buyers (created_at, name, phone, areas, property_types, max_price, cash, notes, pof, closed_before, responsiveness)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(now(), "Demo Capital LLC", "555-0100", "detroit, warren", "single_family, duplex", 200000, 1, "ws-demo", 1, 1, 5);
      return res.json({ ok: true, seeded: true });
    }
    db.prepare("DELETE FROM leads WHERE source='ws-demo'").run();
    db.prepare("DELETE FROM buyers WHERE notes='ws-demo'").run();
    res.json({ ok: true, seeded: false });
  });

  return { db, matchBuyers };
}
