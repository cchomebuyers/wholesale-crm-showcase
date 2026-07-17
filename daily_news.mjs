// ============================================================================
// daily_news.mjs — one AI/tech story a day for the Today dashboard
// ============================================================================
// Free RSS/Atom feeds, no dependencies (regex parse — these feeds are simple
// and we only need title/link/description). Picks the most AI/tech-relevant
// recent item; when an Anthropic key is available, Claude writes the summary
// and a "why it matters for your business" line, otherwise a clean
// deterministic excerpt. Returns the cache object or null.

const FEEDS = [
  { source: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", kind: "rss" },
  { source: "Hacker News", url: "https://hnrss.org/frontpage", kind: "rss" },
  { source: "The Verge", url: "https://www.theverge.com/rss/index.xml", kind: "atom" },
];

const KEYWORDS = [
  ["ai", 3], ["artificial intelligence", 4], ["llm", 4], ["claude", 5], ["anthropic", 5],
  ["openai", 4], ["gpt", 3], ["agent", 3], ["model", 2], ["machine learning", 3],
  ["startup", 1], ["chip", 2], ["nvidia", 2], ["software", 1], ["automation", 2], ["robot", 2],
];

const strip = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ").trim();

function parseItems(xml, kind, source) {
  const items = [];
  const blockRe = kind === "atom" ? /<entry[\s>][\s\S]*?<\/entry>/g : /<item[\s>][\s\S]*?<\/item>/g;
  for (const block of xml.match(blockRe) || []) {
    const title = strip((block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    let link = "";
    if (kind === "atom") link = (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    else link = strip((block.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1]);
    const desc = strip((block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/) || [])[1]);
    if (title && link) items.push({ title, link, desc, source });
  }
  return items.slice(0, 15);
}

const score = (it) => {
  const hay = (it.title + " " + it.desc).toLowerCase();
  return KEYWORDS.reduce((s, [w, pts]) => s + (hay.includes(w) ? pts : 0), 0);
};

async function fetchFeed(f) {
  const r = await fetch(f.url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "wholesale-crm/1.0" } });
  if (!r.ok) throw new Error(`${f.source} ${r.status}`);
  return parseItems(await r.text(), f.kind, f.source);
}

async function aiPolish(apiKey, story) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(
    {
      model: "claude-opus-4-8",
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      system:
        "You brief a solo real-estate wholesaler in Detroit who also builds AI tooling for his own business. " +
        "Given a news story (title + excerpt), return STRICT JSON only: " +
        '{"summary": "<3-4 plain sentences on what happened>", "why": "<1-2 sentences: why this matters for his business — AI leverage, cost, tooling, or market angle. Be concrete, not generic.>"}',
      messages: [{ role: "user", content: `Title: ${story.title}\nSource: ${story.source}\nExcerpt: ${story.desc.slice(0, 1500)}` }],
    },
    { timeout: 45_000, maxRetries: 1 },
  );
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

export async function refreshDailyNews({ apiKey = null, day = new Date().toISOString().slice(0, 10) } = {}) {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!items.length) return null;
  const best = items.map((it) => ({ ...it, s: score(it) })).sort((a, b) => b.s - a.s)[0];

  let summary = best.desc.split(/(?<=[.!?])\s+/).slice(0, 4).join(" ").slice(0, 600) || best.title;
  let why = null, aiWritten = false;
  if (apiKey) {
    try {
      const polished = await aiPolish(apiKey, best);
      if (polished?.summary) { summary = polished.summary; why = polished.why || null; aiWritten = true; }
    } catch (e) { console.error("news: AI polish unavailable —", e.message); }
  }
  return { day, fetchedAt: new Date().toISOString(), headline: best.title, summary, why,
    url: best.link, source: best.source, aiWritten };
}
