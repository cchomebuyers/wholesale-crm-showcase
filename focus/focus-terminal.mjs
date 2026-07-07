#!/usr/bin/env node
// ============================================================================
// focus-terminal.mjs — the Focus Terminal (ADHD daily command center)
// ============================================================================
// A dependency-free ANSI TUI over the live crm.db (same hand-rolled style as
// the MatrixBoot renderer in crm-app.mjs). One big NEXT ACTION, today's tasks,
// KPI bars, a Pomodoro timer, and the agent approval queue — one screen,
// one thing at a time.
//
// Run:  npm run focus   ·   double-click Focus.command   ·   node focus/focus-terminal.mjs
// Keys: ↑/↓ or j/k select · space done · n brain-dump · f focus timer · r refresh · q quit
// Env:  CRM_DB=/path/to/crm.db overrides the db · non-TTY prints a one-shot digest

import { existsSync } from "node:fs";
import { openFocusDb, loadGoals, DB_PATH } from "./focus-data.mjs";
import { rankPlan, getNextAction, polishNextAction } from "./focus-coach.mjs";

const major = +process.versions.node.split(".")[0];
if (major < 22) {
  console.error(`Focus Terminal needs Node 22+ (node:sqlite). You have ${process.version}.`);
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`crm.db not found at ${DB_PATH}\nStart the CRM once (npm start) or set CRM_DB=/path/to/crm.db`);
  process.exit(1);
}

// --- ANSI helpers (house palette: crm-app.mjs MatrixBoot) --------------------
const esc = (s) => `\x1b[${s}`;
const fg = (n) => esc(`38;5;${n}m`);
const RESET = esc("0m"), BOLD = esc("1m");
const C = { white: 231, green: 46, mint: 48, leaf: 35, teal: 79, dim: 245, faint: 238, red: 196, gold: 220 };
const paint = (n, s) => `${fg(n)}${s}${RESET}`;

function bar(done, target, width = 22) {
  const pct = target > 0 ? Math.min(1, done / target) : 1;
  const fill = Math.round(width * pct);
  const color = pct >= 0.8 ? C.green : pct >= 0.4 ? C.gold : C.red;
  return `${fg(color)}${"█".repeat(fill)}${fg(C.faint)}${"░".repeat(width - fill)}${RESET} ${paint(color, String(Math.round(pct * 100)).padStart(3) + "%")}`;
}
const money = (v) => "$" + Math.round(v || 0).toLocaleString("en-US");
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// --- state -------------------------------------------------------------------
const goals = loadGoals();
const store = openFocusDb();
let kpis, tasks, followups, plan, next;
let sel = 0;
let inputMode = false, inputBuf = "";
let flash = "";
let lastPolishedTitle = "";
const pomo = { running: false, phase: "work", left: goals.focus.pomodoroMin * 60, cycles: 0 };

function refresh() {
  try {
    kpis = store.computeKpis(goals);
    tasks = store.listTasks();
    followups = store.followupsDue();
    plan = rankPlan({ kpis, tasks, followups });
    next = getNextAction({ kpis, tasks, followups });
    if (sel >= tasks.length) sel = Math.max(0, tasks.length - 1);
    if (next.title !== lastPolishedTitle) {           // coach polish, non-blocking
      lastPolishedTitle = next.title;
      polishNextAction(next, kpis).then((p) => { if (p.coached && lastPolishedTitle === next.title) { next = p; } }).catch(() => {});
    }
    flash = "";
  } catch { flash = "⟳ db busy — retrying"; }
}

// --- one-shot digest for non-TTY (cron / pipes) --------------------------------
if (!process.stdout.isTTY) {
  refresh();
  const k = kpis;
  console.log(`FOCUS DIGEST · ${new Date().toDateString()}`);
  console.log(`next action : ${next.title}  [${next.timeboxMin}m]  (${next.why})`);
  console.log(`new leads   : ${k.newLeads.done}/${k.newLeads.target}`);
  console.log(`calls       : ${k.calls.done}/${k.calls.target}`);
  console.log(`offers      : ${k.offers.done}/${k.offers.target}`);
  console.log(`followups   : ${k.followups.remaining} due`);
  console.log(`stage moves : ${k.stageAdvances.done}/${k.stageAdvances.target}`);
  console.log(`pipeline    : ${money(k.pipelineFees)} projected · ${money(k.collectedFees)} collected`);
  console.log(`open tasks  : ${tasks.length}`);
  store.close();
  process.exit(0);
}

// --- render --------------------------------------------------------------------
function render() {
  const cols = Math.min(process.stdout.columns || 90, 96);
  const W = cols - 2;
  const line = (ch = "─") => paint(C.faint, ch.repeat(W));
  const out = [];
  const now = new Date();
  const streak = store.tasksDoneToday();

  // header
  out.push("");
  out.push(` ${BOLD}${paint(C.white, "☥  F O C U S")}${RESET}  ${paint(C.dim, now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }))}   ${paint(C.gold, `${goals.copy.streakEmoji} ${streak} done today`)}   ${paint(C.dim, now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))}`);
  out.push(" " + line("═"));

  // NEXT ACTION — the one thing
  out.push(` ${paint(C.teal, "NEXT ACTION")}${next.coached ? paint(C.faint, " · coach") : ""}`);
  out.push(` ${BOLD}${paint(C.green, "▶ " + next.title)}${RESET}`);
  out.push(` ${paint(C.dim, `${next.timeboxMin} min timebox · ${next.why}`)}`);
  out.push(" " + line());

  // tasks
  const openN = tasks.length;
  const total = openN + streak;
  out.push(` ${paint(C.teal, "TASKS")} ${paint(C.dim, `${streak}/${total} done`)}  ${bar(streak, Math.max(1, total), 14)}`);
  const visible = tasks.slice(0, 8);
  if (!visible.length) out.push(`   ${paint(C.dim, "nothing open — brain-dump with 'n'")}`);
  visible.forEach((task, i) => {
    const cur = i === sel;
    const dueToday = task.due_date && task.due_date <= new Date().toISOString().slice(0, 10);
    const box = paint(cur ? C.white : C.dim, "[ ]");
    const label = `${task.title}${task.address ? paint(C.faint, "  · " + task.address) : ""}${dueToday ? paint(C.gold, "  ◈ today") : ""}`;
    out.push(`  ${cur ? paint(C.green, "›") : " "} ${box} ${cur ? BOLD + label + RESET : label}`);
  });
  if (tasks.length > 8) out.push(`   ${paint(C.faint, `… ${tasks.length - 8} more`)}`);
  out.push(" " + line());

  // KPIs
  const k = kpis;
  out.push(` ${paint(C.teal, "KPIs")}  ${paint(C.dim, `pipeline ${money(k.pipelineFees)} · collected ${money(k.collectedFees)}`)}`);
  const row = (label, done, target) => `  ${paint(C.dim, label.padEnd(12))} ${bar(done, target)}  ${paint(C.white, `${done}/${target}`)}`;
  out.push(row("New leads", k.newLeads.done, k.newLeads.target));
  out.push(row("Calls", k.calls.done, k.calls.target));
  out.push(row("Offers", k.offers.done, k.offers.target));
  out.push(row("Stage moves", k.stageAdvances.done, k.stageAdvances.target));
  const fuDone = k.followups.remaining === 0;
  out.push(`  ${paint(C.dim, "Follow-ups".padEnd(12))} ${fuDone ? paint(C.green, "✓ all clear") : paint(C.red, `${k.followups.remaining} due — clear them`)}`);
  out.push(" " + line());

  // focus timer
  const phaseLabel = pomo.phase === "work" ? paint(C.green, "WORK") : paint(C.gold, "BREAK");
  const phaseTotal = (pomo.phase === "work" ? goals.focus.pomodoroMin : (pomo.cycles > 0 && pomo.cycles % goals.focus.cyclesBeforeLongBreak === 0 ? goals.focus.longBreakMin : goals.focus.breakMin)) * 60;
  out.push(` ${paint(C.teal, "FOCUS")}  ${phaseLabel} ${BOLD}${paint(C.white, mmss(pomo.left))}${RESET}  ${bar(phaseTotal - pomo.left, phaseTotal, 18)}  ${paint(C.dim, pomo.running ? "running — 'f' to pause" : "'f' to start")}  ${paint(C.faint, `cycle ${pomo.cycles + 1}`)}`);

  // agent queue
  const approvals = tasks.filter((x) => /^(review new lead|send offer|approve & send)/i.test(x.title));
  out.push(` ${paint(C.teal, "AGENTS")} ${paint(C.dim, approvals.length ? `${approvals.length} approval${approvals.length > 1 ? "s" : ""} waiting in tasks` : "queue empty — run focus/agents/*.mjs to fill it")}`);
  out.push(" " + line("═"));

  // footer / input
  if (inputMode) {
    out.push(` ${paint(C.gold, "brain-dump ▶ ")}${paint(C.white, inputBuf)}${paint(C.dim, "▁")}  ${paint(C.faint, "enter to park it · esc to cancel")}`);
  } else {
    out.push(` ${paint(C.faint, "↑↓/jk select · space done · n brain-dump · f focus · r refresh · q quit")}${flash ? "   " + paint(C.gold, flash) : ""}`);
  }

  process.stdout.write(esc("H") + out.map((l) => l + esc("K")).join("\n") + esc("J"));
}

// --- pomodoro -------------------------------------------------------------------
function tickPomo() {
  if (!pomo.running) return;
  pomo.left--;
  if (pomo.left > 0) return;
  process.stdout.write("\x07"); // bell — phase over
  if (pomo.phase === "work") {
    pomo.cycles++;
    const long = pomo.cycles % goals.focus.cyclesBeforeLongBreak === 0;
    pomo.phase = "break";
    pomo.left = (long ? goals.focus.longBreakMin : goals.focus.breakMin) * 60;
  } else {
    pomo.phase = "work";
    pomo.left = goals.focus.pomodoroMin * 60;
  }
}

// --- keys ------------------------------------------------------------------------
function onKey(ch) {
  if (inputMode) {
    if (ch === "\r" || ch === "\n") {
      const title = inputBuf.trim();
      if (title) { try { store.addTask(title); flash = "parked ✓"; } catch { flash = "⟳ db busy"; } }
      inputMode = false; inputBuf = ""; refresh();
    } else if (ch === "\x1b") { inputMode = false; inputBuf = ""; }
    else if (ch === "\x7f" || ch === "\b") inputBuf = inputBuf.slice(0, -1);
    else if (ch >= " " && ch.length === 1) inputBuf += ch;
    render();
    return;
  }
  switch (ch) {
    case "q": case "\x03": return quit();
    case "j": case "\x1b[B": sel = Math.min(sel + 1, Math.max(0, Math.min(tasks.length, 8) - 1)); break;
    case "k": case "\x1b[A": sel = Math.max(sel - 1, 0); break;
    case " ": {
      const task = tasks[sel];
      if (task) { try { store.toggleTask(task.id); flash = "done ✓"; } catch { flash = "⟳ db busy"; } refresh(); }
      break;
    }
    case "n": inputMode = true; inputBuf = ""; break;
    case "f": pomo.running = !pomo.running; break;
    case "r": refresh(); break;
  }
  render();
}

function quit() {
  clearInterval(timer);
  clearInterval(slowTimer);
  process.stdout.write(esc("2J") + esc("H") + esc("?25h"));
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  store.close();
  process.exit(0);
}

// --- boot ---------------------------------------------------------------------------
refresh();
process.stdout.write(esc("2J") + esc("?25l"));
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", onKey);
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
const timer = setInterval(() => { tickPomo(); render(); }, 1000);
const slowTimer = setInterval(refresh, 5000); // live db without hammering it
render();
