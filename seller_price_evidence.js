// seller_price_evidence.js -- extract seller-side price evidence.
//
// The spread gate needs the seller's acceptable number. This module reads
// structured fields first, then parses notes/messages for common acquisition
// language: "asking 80k", "would take 75,000", "seller wants 90k", etc.

const moneyRe = /\$?\s*([0-9]{2,3}(?:,[0-9]{3})+|[0-9]{4,6}|[0-9]{2,3}(?:\.[0-9]+)?\s*k)\b/ig;
const strongContext = /(take|accept|accepted|bottom|lowest|min(?:imum)?|seller\s+wants?|wants?|needs?|would\s+do|would\s+take|contract|agreed|counter)/i;
const askContext = /(ask(?:ing)?|list(?:ed|ing)?|price|offer|counter)/i;
const rejectContext = /(arv|repair|repairs|rent|fee|assignment|buyer|max allowable|mao|comps?|assessed|tax|balance due|shootings?|score)/i;

function parseMoneyToken(token) {
  if (!token) return null;
  const s = String(token).toLowerCase().replace(/\s+/g, "");
  let n;
  if (s.endsWith("k")) n = Number(s.replace(/[^0-9.]/g, "")) * 1000;
  else n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 1000 || n > 10000000) return null;
  return Math.round(n);
}

function confidenceForContext(ctx) {
  if (strongContext.test(ctx)) return "high";
  if (askContext.test(ctx)) return "medium";
  return "low";
}

export function extractSellerPriceEvidence(text, { source = "text", recordId = null } = {}) {
  const body = String(text || "");
  if (!body.trim()) return [];
  const out = [];
  for (const m of body.matchAll(moneyRe)) {
    const price = parseMoneyToken(m[1]);
    if (!price) continue;
    const start = Math.max(0, m.index - 80);
    const end = Math.min(body.length, m.index + m[0].length + 80);
    const context = body.slice(start, end).replace(/\s+/g, " ").trim();
    const localStart = Math.max(0, m.index - 24);
    const localEnd = Math.min(body.length, m.index + m[0].length + 24);
    const localContext = body.slice(localStart, localEnd).replace(/\s+/g, " ").trim();
    if (/(arv|repair|repairs|rent|fee|assignment|buyer|max allowable|mao|comps?|assessed|tax|balance due)\s*:?\s*$/i.test(body.slice(localStart, m.index))) continue;
    if (rejectContext.test(localContext) && !strongContext.test(localContext) && !askContext.test(localContext)) continue;
    if (rejectContext.test(context) && !strongContext.test(context) && !askContext.test(context)) continue;
    const confidence = confidenceForContext(context);
    out.push({
      price,
      confidence,
      source,
      record_id: recordId,
      context,
      reason: confidence === "high" ? "seller acceptance language near price" :
        confidence === "medium" ? "asking/list/counter language near price" :
        "price mentioned without strong seller context",
    });
  }
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.price}:${x.source}:${x.record_id}:${x.context}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function structuredSellerPriceEvidence(record = {}) {
  const fields = [
    ["seller_acceptable_price", "high"],
    ["seller_min_price", "high"],
    ["contract_price", "high"],
    ["asking_price", "medium"],
    ["price", "medium"],
  ];
  const out = [];
  for (const [field, confidence] of fields) {
    const n = parseMoneyToken(record[field]);
    if (n) out.push({
      price: n,
      confidence,
      source: field,
      record_id: record.id ?? null,
      context: `${field}=${n}`,
      reason: `structured ${field}`,
    });
  }
  return out;
}

const rank = { high: 3, medium: 2, low: 1 };

export function bestSellerPriceEvidence(items = []) {
  const sorted = [...items].filter((x) => x && x.price)
    .sort((a, b) => (rank[b.confidence] || 0) - (rank[a.confidence] || 0) || a.price - b.price);
  return sorted[0] || null;
}

export function sellerPriceEvidenceFromRecord(record = {}, relatedTexts = []) {
  const items = [...structuredSellerPriceEvidence(record)];
  for (const t of relatedTexts) {
    items.push(...extractSellerPriceEvidence(t.text || t.body || "", {
      source: t.source || "related_text",
      recordId: t.record_id ?? t.id ?? null,
    }));
  }
  return items;
}
