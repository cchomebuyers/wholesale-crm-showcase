#!/usr/bin/env node
// ============================================================================
// Wholesale CRM — one-click live app launcher (with Matrix boot screen)
// ============================================================================
// Boots the whole stack and opens it as a desktop-style app window:
//   • the CRM substrate  (node --watch server.js  -> :4000, auto-restarts on change)
//   • the ankhor shell   (vite dev                -> :8080, hot-module-reload)
//   • a chromeless app window pointed at ankhor, where Apps -> Wholesale CRM ->
//     Launch embeds the CRM full-bleed in an iframe.
//
// While it boots, a green "digital rain" terminal animation loads the data.
//
// "Auto-updating / hot reload": nothing is compiled or frozen. Both servers run
// in WATCH mode, so ANY code change is live immediately — backend edits restart
// the CRM (node --watch), frontend edits hot-swap in the browser (vite HMR). The
// .exe is a thin wrapper around THIS file, so it never needs rebuilding.
//
// Run:  double-click WholesaleCRM.exe (or "Wholesale CRM.cmd", or: npm run app)
// Env:  CRM_NO_WINDOW=1 skips the window · CRM_NO_MATRIX=1 skips the animation

import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ANKHOR = join(ROOT, 'ankhor88_remix');
const CRM_PORT = Number(process.env.CRM_PORT || 4000);
const ANKHOR_PORT = Number(process.env.ANKHOR_PORT || 8080);
const OPEN_WINDOW = process.env.CRM_NO_WINDOW !== '1';

const children = [];
let shuttingDown = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Matrix "digital rain" boot screen (TTY only; plain logs otherwise)
// ============================================================================
class MatrixBoot {
  constructor() {
    this.tty = !!process.stdout.isTTY && process.env.CRM_NO_MATRIX !== '1';
    this.cols = process.stdout.columns || 90;
    this.rows = process.stdout.rows || 30;
    this.chars = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆ0123456789<>*+=$#@%&'.split('');
    this.drops = [];
    this.flavors = [
      'mounting thinga substrate…', 'opening crm.db…', 'indexing lead pipeline…',
      'warming IndexedDB…', 'linking ankhor ⇄ crm bridge…', 'decrypting operator session…',
      'compiling hot-reload graph…', 'spinning up vite HMR…',
    ];
    this.flavorIdx = 0;
    this.tasks = [
      { label: 'CRM substrate   node --watch', port: CRM_PORT, up: false },
      { label: 'ankhor shell    vite HMR', port: ANKHOR_PORT, up: false },
    ];
    this.timer = null;
    this.frameN = 0;
  }
  rc() { return this.chars[(Math.random() * this.chars.length) | 0]; }
  start() {
    if (!this.tty) return;
    for (let x = 0; x < this.cols; x++) this.drops[x] = ((Math.random() * this.rows) | 0) - this.rows;
    process.stdout.write('\x1b[?25l\x1b[2J');
    this.timer = setInterval(() => this.frame(), 55);
  }
  frame() {
    this.frameN++;
    if (this.frameN % 12 === 0) this.flavorIdx = (this.flavorIdx + 1) % this.flavors.length;
    let out = '';
    const shades = [231, 48, 41, 35, 29, 22]; // white head -> deep green tail
    for (let x = 0; x < this.cols; x++) {
      const head = this.drops[x];
      for (let i = 0; i < shades.length; i++) {
        const y = head - i;
        if (y >= 0 && y < this.rows) out += `\x1b[${y + 1};${x + 1}H\x1b[38;5;${shades[i]}m${this.rc()}`;
      }
      const erase = head - shades.length;
      if (erase >= 0 && erase < this.rows) out += `\x1b[${erase + 1};${x + 1}H `;
      this.drops[x]++;
      if (this.drops[x] > this.rows + shades.length) this.drops[x] = -((Math.random() * 12) | 0);
    }
    process.stdout.write(out);
    this.panel();
  }
  panel() {
    const lines = [
      '  \x1b[1;38;5;231m☥  W H O L E S A L E   C R M\x1b[0m',
      '  \x1b[38;5;35mloading live substrate…\x1b[0m',
      '',
      `  \x1b[38;5;48m▓\x1b[0m \x1b[38;5;79m${this.flavors[this.flavorIdx]}\x1b[0m`,
      '',
      ...this.tasks.map((t) => {
        const dot = t.up ? '\x1b[38;5;46m●\x1b[0m' : '\x1b[38;5;238m◌\x1b[0m';
        const txt = t.up ? `\x1b[38;5;46m${t.label}  :${t.port}  ✓\x1b[0m` : `\x1b[38;5;245m${t.label}  :${t.port}\x1b[0m`;
        return `  ${dot} ${txt}`;
      }),
    ];
    const w = 42;
    const boxW = w + 4;
    const left = Math.max(1, ((this.cols - boxW) / 2) | 0);
    const top = Math.max(1, (this.rows / 2 - lines.length / 2 - 1) | 0);
    // background plate
    let out = '';
    const bg = '\x1b[48;5;233m';
    for (let i = -1; i <= lines.length; i++) {
      out += `\x1b[${top + i + 1};${left + 1}H${bg}${' '.repeat(boxW)}\x1b[0m`;
    }
    lines.forEach((ln, i) => {
      out += `\x1b[${top + i + 1};${left + 2}H${bg}${ln}\x1b[0m`;
    });
    process.stdout.write(out);
  }
  markUp(port) {
    const t = this.tasks.find((t) => t.port === port);
    if (t) t.up = true;
    if (!this.tty) console.log(`  \x1b[32m✓\x1b[0m online :${port}`);
  }
  note(msg) { if (!this.tty) console.log(`  ▶ ${msg}`); }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.tty) process.stdout.write('\x1b[2J\x1b[H\x1b[?25h');
  }
}

// ============================================================================
const boot = new MatrixBoot();

function portOpen(port) {
  return new Promise((res) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('timeout', () => { s.destroy(); res(false); });
    s.on('error', () => res(false));
  });
}
async function waitPort(port, label, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portOpen(port)) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label} on :${port}`);
}

function run(tag, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: opts.cwd || ROOT, env: { ...process.env, ...opts.env } });
  const pipe = (buf) => { if (!boot.tty) buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => process.stdout.write(`[${tag}] ${l}\n`)); };
  p.stdout.on('data', pipe);
  p.stderr.on('data', pipe);
  p.on('exit', (code) => { if (!shuttingDown && !boot.tty) process.stdout.write(`[${tag}] exited (${code})\n`); });
  children.push(p);
  return p;
}
function killTree(pid) {
  if (!pid) return;
  try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* noop */ }
}
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  boot.stop();
  process.stdout.write('  shutting down…\n');
  for (const c of children) killTree(c.pid);
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function findBrowser() {
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => existsSync(p)) || null;
}
function openAppWindow(url) {
  const browser = findBrowser();
  if (!browser) { spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }); return; }
  const startedAt = Date.now();
  const win = spawn(browser, [
    `--app=${url}`, `--user-data-dir=${join(ROOT, '.crm-app-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,960',
  ], { detached: false });
  children.push(win);
  win.on('exit', () => { if (Date.now() - startedAt > 3000 && !shuttingDown) shutdown(0); });
}

async function main() {
  boot.start();

  if (!existsSync(join(ANKHOR, 'node_modules', 'vite'))) {
    boot.note('installing ankhor dependencies (first run)…');
    const r = spawnSync('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'],
      { cwd: ANKHOR, stdio: boot.tty ? 'ignore' : 'inherit', shell: true });
    if (r.status !== 0) { boot.stop(); console.error('npm install failed'); process.exit(1); }
  }

  if (!(await portOpen(CRM_PORT))) {
    boot.note('starting CRM substrate (node --watch)…');
    run('crm', process.execPath, ['--watch', 'server.js'], { cwd: ROOT, env: { NO_BACKUP: '1' } });
  }
  if (!(await portOpen(ANKHOR_PORT))) {
    boot.note('starting ankhor shell (vite HMR)…');
    run('ankhor', process.execPath, [join(ANKHOR, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: ANKHOR });
  }

  await waitPort(CRM_PORT, 'CRM'); boot.markUp(CRM_PORT);
  await waitPort(ANKHOR_PORT, 'ankhor'); boot.markUp(ANKHOR_PORT);
  await sleep(boot.tty ? 900 : 0); // let the "all green" state land visibly

  boot.stop();
  const url = `http://localhost:${ANKHOR_PORT}/`;
  process.stdout.write(
    `\x1b[38;5;46m\n  ☥  WHOLESALE CRM — live\x1b[0m\n` +
    `     CRM substrate  →  http://localhost:${CRM_PORT}\n` +
    `     ankhor shell   →  ${url}\n\n` +
    `     Apps → Wholesale CRM → Launch  ·  edits hot-reload live\n` +
    `     Close the window or press Ctrl+C to quit.\n\n`
  );
  if (OPEN_WINDOW) openAppWindow(url);
}

// Run only when executed directly (exe / .cmd / `npm run app`), not when imported.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { boot.stop(); console.error('launch error:', e.message); shutdown(1); });

export { MatrixBoot };
