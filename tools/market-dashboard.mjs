#!/usr/bin/env node
// Market research TUI dashboard — renders docs/market-research-2026-07.md as visual KPIs.
// Zero dependencies. Interactive in a terminal: ←/→ or 1-6 to switch tabs, q to quit.
// `node tools/market-dashboard.mjs --all` (or piping) prints every section statically.
// Data is a hand-extracted snapshot of the July 2026 report; sources cited there.

const ESC = '\x1b';
const R = `${ESC}[0m`, BOLD = `${ESC}[1m`;
const fg = (hex) => {
  const [r, g, b] = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `${ESC}[38;2;${r};${g};${b}m`;
};

// dataviz reference palette (dark-mode steps; readable on light terminals too)
const C = {
  blue: fg('#3987e5'),    // sequential hue — all magnitude bars
  aqua: fg('#199e70'),
  violet: fg('#9085e9'),
  muted: fg('#898781'),   // axis / labels / borders
  good: fg('#0ca30c'),
  warning: fg('#fab219'),
  serious: fg('#ec835a'),
  critical: fg('#d03b3b'),
};

const W = Math.max(72, Math.min(process.stdout.columns || 100, 100));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const vlen = (s) => strip(s).length;
const padE = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));
const padS = (s, n) => ' '.repeat(Math.max(0, n - vlen(s))) + s;
const center = (s, n) => {
  const gap = Math.max(0, n - vlen(s));
  return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
};

// ── components ────────────────────────────────────────────────────────────────

// KPI tile row: 3 per line, hairline box, colored accent bar, value in bold ink
function tiles(items) {
  const per = 3, gap = 2;
  const tw = Math.floor((W - gap * (per - 1)) / per);
  const lines = [];
  for (let i = 0; i < items.length; i += per) {
    const row = items.slice(i, i + per);
    const g = ' '.repeat(gap);
    lines.push(row.map((t) => C.muted + '┌─ ' + t.label + ' ' + '─'.repeat(Math.max(0, tw - 5 - vlen(t.label))) + '┐' + R).join(g));
    const clip = (s) => vlen(s) > tw - 6 ? s.slice(0, tw - 7) + '…' : s;
    lines.push(row.map((t) => C.muted + '│ ' + R + (t.color || C.blue) + '▍' + R + BOLD + padE(clip(t.value), tw - 6) + R + C.muted + ' │' + R).join(g));
    lines.push(row.map((t) => C.muted + '│ ' + R + '  ' + (t.subColor || C.muted) + padE(clip(t.sub || ''), tw - 6) + R + C.muted + ' │' + R).join(g));
    lines.push(row.map(() => C.muted + '└' + '─'.repeat(tw - 2) + '┘' + R).join(g));
  }
  return lines;
}

// horizontal bar chart — one hue (magnitude job), direct value labels, muted axis
function bars(rows, { labelW = 16, color = C.blue, unit = '' } = {}) {
  const max = Math.max(...rows.map((r) => r.hi ?? r.v));
  const maxLbl = Math.max(...rows.map((r) => vlen(r.label ?? (unit + r.v.toLocaleString()))));
  const span = Math.max(12, W - labelW - maxLbl - 4);
  return rows.map((r) => {
    const v = r.v, hi = r.hi;
    const n = Math.max(1, Math.round((v / max) * span));
    let bar = (r.color || color) + '█'.repeat(n) + R;
    if (hi != null) { // range: solid to low value, dim ░ to high
      const nHi = Math.max(n, Math.round((hi / max) * span));
      bar += (r.color || color) + '░'.repeat(nHi - n) + R;
    }
    const val = r.label ?? (unit + v.toLocaleString());
    return C.muted + padS(r.name, labelW) + ' ▏' + R + bar + ' ' + BOLD + val + R;
  });
}

function heading(t) {
  return [ '', BOLD + t + R + '  ' + C.muted + '─'.repeat(Math.max(0, W - vlen(t) - 3)) + R ];
}
const note = (s) => C.muted + '  ' + s + R;
const statusRow = (color, head, rest) =>
  '  ' + color + '●' + R + ' ' + BOLD + padE(head, 16) + R + ' ' + C.muted + rest + R;

// ── sections ──────────────────────────────────────────────────────────────────

const SECTIONS = [
  ['Overview', () => [
    ...heading('HEADLINE KPIs'),
    ...tiles([
      { label: 'MARKET SIZE', value: '$4B+', sub: '2025 · →$15B by 2033 proj' },
      { label: 'AVG ASSIGNMENT FEE', value: '$13,000', sub: '$5K AZ – $22K NC/GA' },
      { label: 'FLIP ROI', value: '25.5%', sub: 'lowest since 2008', color: C.serious, subColor: C.serious },
      { label: 'FORECLOSURES Q1 26', value: '118,727', sub: '+26% YoY · 6-year high', color: C.good, subColor: C.good },
      { label: 'LEAD → CLOSE', value: '73 days', sub: 'median · needs 5–8 touches' },
      { label: 'QUIT AT DAY 30', value: '−94%', sub: 'of future deals forfeited', color: C.critical, subColor: C.critical },
    ]),
    ...heading('THE SQUEEZE  (supply up · exits harder)'),
    statusRow(C.good, 'Seller supply', 'foreclosures +26% YoY, insurance/tax shock minting motivated sellers'),
    statusRow(C.serious, 'Buyer pool', 'flippers at thinnest margins since 2008; institutions down 90%+ since 2022'),
    statusRow(C.serious, 'Regulation', '6 new state laws in 2025; ~10 states license after 1–2 assignments'),
    statusRow(C.good, 'The move', 'novations/wholetailing: $30K+ retail exits vs $10–15K assignments'),
    '',
    note('Net read: more motivated sellers, pickier lower-paying buyers. Tight comping + follow-up wins.'),
  ]],

  ['Market', () => [
    ...heading('AVG ASSIGNMENT FEE BY STATE  ($K)'),
    ...bars([
      { name: 'NC / GA (high)', v: 22, label: '$22K' },
      { name: 'national avg', v: 13, label: '$13K' },
      { name: 'AZ (low)', v: 5, label: '$5K' },
    ]),
    ...heading('TOP METROS — MEDIAN PRICE  ($K)   (shift: Sun Belt → Midwest/Northeast)'),
    ...bars([
      { name: 'Jacksonville', v: 280, label: '$280K · military rental demand' },
      { name: 'Houston (TX)', v: 264, label: '$264K · #1 cash-buyer volume' },
      { name: 'Indianapolis', v: 230, label: '$230K · worst foreclosure rate = pipeline' },
      { name: 'Philadelphia', v: 229, label: '$229K · "missing middle" sweet spot' },
      { name: 'Rochester', v: 227, label: '$227K · Buffalo pends in 14 days' },
      { name: 'Detroit', v: 76, label: '$76K · lowest entry cost in US' },
    ]),
    ...heading('EXIT STRATEGY SPREADS  ($K per deal)'),
    ...bars([
      { name: 'novation', v: 30, label: '$30K+  ← the breakout strategy', color: C.aqua },
      { name: 'assignment', v: 12.5, hi: 15, label: '$10–15K' },
    ]),
    '',
    note('2025 flips: 297,045 — fewest since 2020. Q1 26 broke a 7-quarter margin decline.'),
  ]],

  ['Legal', () => [
    ...heading('STATE REGULATION HEAT  (● severity)'),
    statusRow(C.critical, 'South Carolina', 'de facto ban — license required to market property you don\'t own'),
    statusRow(C.critical, 'Oklahoma', 'license to market; SB 1075 now covers double closings; $5K/violation'),
    statusRow(C.serious, 'Pennsylvania', 'license required + 30-day seller cancellation (non-waivable)'),
    statusRow(C.serious, 'Connecticut', 'registration regime LIVE July 1 2026 · 3-day cancel · 90-day close cap'),
    statusRow(C.serious, 'Illinois', 'ONE unlicensed deal per 12 months · up to $25K per violation'),
    statusRow(C.warning, 'OH · MD · TN · ND · AZ', 'disclosure regimes — missing disclosure = seller can rescind'),
    statusRow(C.warning, 'Minnesota', 'broker license presumed at 5+ deals / 12 months'),
    statusRow(C.muted, 'California', 'AB 1850 pending — would require license + disclosure'),
    ...heading('FEDERAL / TCPA'),
    statusRow(C.good, '1:1 consent rule', 'DEAD — vacated Jan 2025, formally repealed Sept 2025'),
    statusRow(C.critical, 'Cold SMS', 'functionally dead — carriers block unregistered A2P since Feb 2025'),
    statusRow(C.warning, 'Revocation rules', 'live since Apr 2025 — honor any-channel opt-out within 10 business days'),
    statusRow(C.warning, 'Exposure', '$500–$1,500 per call/text · TCPA class actions +95% YoY'),
    '',
    note('Template: written pre-contract disclosure + seller cancel rights.'),
    note('Golden rule: market the CONTRACT, never the property.'),
  ]],

  ['Lead Gen', () => [
    ...heading('COST PER DEAL BY CHANNEL  ($, solid = low → ░ = high estimate)'),
    ...bars([
      { name: 'referrals', v: 300, label: '~$0–minimal · 15–30% close · most profitable', color: C.aqua },
      { name: 'SMS (opt-in)', v: 400, hi: 1200, label: '$400–1.2K · only as registered follow-up' },
      { name: 'direct mail', v: 500, hi: 2000, label: '$500–2K · the foundation channel' },
      { name: 'cold calling', v: 800, hi: 2500, label: '$800–2.5K · 8–15% contact rate' },
      { name: 'PPC / Google', v: 2000, hi: 8000, label: '$2K–8K · highest intent, priciest' },
    ], { labelW: 14 }),
    ...heading('FOLLOW-UP FUNNEL  (why day 30 quitters lose)'),
    ...bars([
      { name: 'close ≤ day 30', v: 6, label: '~6% of eventual deals' },
      { name: 'days 61–90', v: 36, label: '36% close in this window' },
      { name: 'after day 30', v: 94, label: '94% — forfeited if you stop', color: C.aqua },
    ], { labelW: 16 }),
    ...heading('$5K/MO BUDGET ALLOCATION  (scaled benchmark)'),
    ...bars([
      { name: 'direct mail', v: 65, label: '60–70%' },
      { name: 'call follow-up', v: 17, label: '15–20%' },
      { name: 'FB retargeting', v: 8, label: '5–10%' },
      { name: 'SEO / inbound', v: 8, label: '5–10%' },
    ], { labelW: 16 }),
    '',
    note('List quality > mail format. Stack 2–3 distress signals (tax delinquent + absentee + high equity).'),
    note('$3–5K/mo well-run ≈ 1–2 deals/month once pipeline matures (~2–3 months latency).'),
  ]],

  ['Software', () => [
    ...heading('TYPICAL MONTHLY STACK COST  ($, solid = low → ░ = high)'),
    ...bars([
      { name: 'SMS platform', v: 200, hi: 400, label: '$200–400 (shrinking)' },
      { name: 'CRM', v: 99, hi: 299, label: '$99–299' },
      { name: 'dialer/phone', v: 119, hi: 300, label: '$119–300' },
      { name: 'data/lists', v: 99, hi: 199, label: '$99–199' },
      { name: 'website', v: 84, hi: 169, label: '$84–169' },
      { name: 'ALL-IN', v: 547, hi: 1047, label: '$547–1,047/mo before mail', color: C.serious },
      { name: 'your wedge', v: 49, hi: 99, label: '$49–99 flat — undercuts everyone', color: C.aqua },
    ], { labelW: 14 }),
    ...heading('INCUMBENT WEAK POINTS'),
    statusRow(C.critical, 'BatchLeads', 'BBB F — billing-after-cancellation complaints'),
    statusRow(C.critical, 'FreedomSoft', 'BBB D- — buggy, aggressive upselling, shared lead data'),
    statusRow(C.warning, 'REsimpli', 'best brand (5.0 Trustpilot) but pricey, weak dispo/buyer side'),
    statusRow(C.warning, 'Everyone', 'non-exclusive data — every subscriber pulls the same lists'),
    ...heading('GAPS A CUSTOM CRM EXPLOITS'),
    note('1. Stack consolidation at honest flat pricing   2. Native compliance engine (consent ledger, DNC)'),
    note('3. Dispo/buyer-side depth (buy-box matching)    4. Zero-setup opinionated pipelines'),
    note('5. Speed-to-lead AI triage                      6. PropStream/Batch merger churn = movable users'),
  ]],

  ['Economics', () => [
    ...heading('UNIT ECONOMICS'),
    ...tiles([
      { label: 'GROSS MARGIN / DEAL', value: '60–80%', sub: '$13K fee − $1.5–4K cost', color: C.good },
      { label: 'OVERHEAD BEFORE $1', value: '$2.5–6K/mo', sub: 'tools + VAs, pre-revenue', color: C.serious, subColor: C.serious },
      { label: 'CASH CYCLE', value: '60–90 days', sub: 'months of spend before revenue' },
      { label: 'SOLO VELOCITY', value: '1 deal/mo', sub: 'competent; teams 5–10/mo' },
      { label: 'MEDIAN FT INCOME', value: '$54–56K/yr', sub: 'not guru six figures' },
      { label: 'NEVER CLOSE A DEAL', value: '~90%+', sub: 'most fail before first OFFER', color: C.critical, subColor: C.critical },
    ]),
    ...heading('WHERE THE MONEY IS MOVING'),
    statusRow(C.good, 'Novations', '$10–30K+ retail-exit spreads, 2–3x assignments'),
    statusRow(C.good, 'Agent hybrid', 'license converts legal risk into commissions + MLS dispo'),
    statusRow(C.good, 'Land', 'less competition, no rehab · $7–15K growth corridors'),
    statusRow(C.warning, 'Institutions', 'buyer pool is mom-and-pop now — 91% of investor homes held by <10-unit owners'),
    ...heading('OUTLOOK 2026–29'),
    note('Rates mid-6% → 5.25–5.75% by 2027. Flips bottomed 2025; margins turned Q1 26.'),
    note('AI repriced the labor stack: a 2-person team now runs what took 6 people in 2021.'),
    note('Base case: wholesaling professionalizes. Survivor profile = compliant + capitalized + tech-run.'),
  ]],
];

// ── render ────────────────────────────────────────────────────────────────────

function header(active) {
  const title = ' WHOLESALE MARKET DASHBOARD ';
  const src = 'docs/market-research-2026-07.md · compiled 2026-07-10';
  const lines = [
    C.blue + BOLD + center(title, W) + R,
    C.muted + center(src, W) + R,
    '',
  ];
  if (active != null) {
    const tabs = SECTIONS.map(([name], i) =>
      i === active
        ? C.blue + BOLD + `[${i + 1} ${name}]` + R
        : C.muted + ` ${i + 1} ${name} ` + R
    ).join(' ');
    lines.push(center(tabs, W), C.muted + '─'.repeat(W) + R);
  }
  return lines;
}

function renderSection(i) {
  return SECTIONS[i][1]().join('\n');
}

const wantAll = process.argv.includes('--all') || !process.stdout.isTTY;

if (wantAll) {
  console.log(header(null).join('\n'));
  SECTIONS.forEach(([name], i) => {
    console.log('\n' + C.blue + BOLD + `▌ ${i + 1}. ${name.toUpperCase()}` + R);
    console.log(renderSection(i));
  });
  console.log('');
} else {
  let active = 0;
  const draw = () => {
    process.stdout.write(`${ESC}[2J${ESC}[H`);
    console.log(header(active).join('\n'));
    console.log(renderSection(active));
    console.log('\n' + C.muted + center('←/→ or 1–6 switch · q quit', W) + R);
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString();
    if (k === 'q' || k === '\x03') { process.stdout.write(`${ESC}[2J${ESC}[H`); process.exit(0); }
    if (k === `${ESC}[C` || k === 'l') active = (active + 1) % SECTIONS.length;
    if (k === `${ESC}[D` || k === 'h') active = (active + SECTIONS.length - 1) % SECTIONS.length;
    if (/^[1-6]$/.test(k)) active = Number(k) - 1;
    draw();
  });
  process.stdout.on('resize', draw);
  draw();
}
