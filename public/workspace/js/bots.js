// ============================================================================
// bots.js — the clawdbot sprites (ported from focus/focus-web.html)
// ============================================================================
// Soft-pixel lobster sprites, one accessory per job. 20×18 grid → rounded
// anti-aliased SVG rects. Claws render in their own <g> so they SNIP while
// the agent works (see .bot animations in shell.css). Colors here are sprite
// artwork (image content), not UI chrome — the tokens.css no-raw-hex rule
// governs chrome, not pixel art.
// '.'=empty r=shell d=shade w=eye a=accessory x=lens

const BOT_BASE = [
  "....d..........d....",
  "....d..........d....",
  "..rrrr........rrrr..",
  ".rrrrrr......rrrrrr.",
  ".rrrrrr......rrrrrr.",
  ".rrrr..........rrrr.",
  "..rrr..dddddd..rrr..",
  "...rr.drrrrrrd.rr...",
  "......rrrrrrrr......",
  ".....rrwwrrwwrr.....",
  "......rrrrrrrr......",
  "......drrrrrrd......",
  ".......rrrrrr.......",
  "......drrrrrrd......",
  ".......rrrrrr.......",
  "......r.rrrr.r......",
  ".....rr.rrrr.rr.....",
  "....rrrrrrrrrrrr....",
];

export const BOTS = {
  momentum:     { color: "#fbbf24", title: "hard hat — keeps the pipeline moving",
    overlay: { 5: ".......aaaaaa.......", 6: ".....aaaaaaaaaa....." } },
  acquisitions: { color: "#cbd5e1", title: "binoculars — scouts new deals",
    overlay: { 9: ".....aaxxaaxxaa.....", 10: ".....aaxxaaxxaa....." } },
  underwriting: { color: "#34d399", title: "eyeshade — runs the numbers",
    overlay: { 8: ".....aaaaaaaaaa.....", 9: "....a..........a...." } },
  outreach:     { color: "#8b8ff0", title: "headset — drafts the scripts",
    overlay: { 6: "......aaaaaaaa......", 9: "....aa........aa....", 10: "....a...............", 11: "....aa.............." } },
  engine:       { color: "#5eead4", title: "antenna — autonomous lead engine",
    overlay: { 0: ".........aa.........", 1: "........a..a........", 2: ".........aa........." } },
  briefing:     { color: "#f5d78e", title: "morning paper — files your daily briefing",
    overlay: { 12: "......aaaaaa........", 13: "......axaxaa........", 14: "......aaaaaa........" } },
  emailer:      { color: "#7dd3fc", title: "envelope — writes your offers in your voice",
    overlay: { 12: "......aaaaaaaa......", 13: "......axaaaaxa......", 14: "......aaaaaaaa......" } },
  doctor:       { color: "#f472b6", title: "stethoscope — checks the system's vitals",
    overlay: { 12: "........aa..........", 13: ".......aaaa.........", 14: "........aa.........." } },
  comps:        { color: "#fb923c", title: "magnifier — prices deals from free comps",
    overlay: { 12: ".......aaa..........", 13: ".......a.a..........", 14: ".......aaa.a........" } },
  replies:      { color: "#a3e635", title: "reply arrow — triages inbound answers",
    overlay: { 12: "........a...........", 13: ".......aaa..........", 14: "......a.a.aaa......." } },
};

export function botSprite(name, size = 56) {
  const b = BOTS[name] || BOTS.engine;
  const pal = { r: "#e0604a", d: "#9c3527", w: "#ffe9e2", a: b.color, x: "#141420" };
  const isClaw = (x, y) => y <= 5 && (x <= 6 || x >= 13);
  const g = { L: "", R: "", B: "" };
  BOT_BASE.forEach((row, y) => {
    const over = b.overlay[y] || "";
    [...row].forEach((ch, x) => {
      const o = over[x];
      const c = o && o !== "." ? o : ch;
      if (c === ".") return;
      const key = isClaw(x, y) ? (x <= 6 ? "L" : "R") : "B";
      g[key] += `<rect x="${x}" y="${y}" width="1.06" height="1.06" rx="0.45" fill="${pal[c] || pal.r}"/>`;
    });
  });
  const host = document.createElement("div");
  host.className = "bot";
  host.innerHTML = `<svg viewBox="0 0 20 18" width="${size}" height="${Math.round(size * 52 / 56)}" role="img" aria-label="${b.title}">
    <g class="clawL">${g.L}</g><g class="clawR">${g.R}</g><g>${g.B}</g></svg>`;
  return host;
}
