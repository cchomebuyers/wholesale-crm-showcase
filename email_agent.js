// ============================================================================
// email_agent.js — pure helpers shared by the Sonny Emailer agent + server
// ============================================================================
// Used by focus/agents/emailer.mjs (drafting) and server.js (email queue).
// No I/O here — everything is testable (email_agent.test.js).

// A lead imported from Acquisitions carries the LISTING AGENT's contact in
// seller_name/seller_email (server.js /api/properties/:id/import tags the
// name with "(listing agent)" and sets source "Acquisitions (RentCast)").
// Everything else — CSV lists, skip-traced owners, manual adds — is the owner.
export function classifyRecipient(lead = {}) {
  const name = lead.seller_name || "";
  const source = lead.source || "";
  if (/\(listing agent\)/i.test(name)) return "realtor";
  if (/acquisitions|rentcast|mls|realtor|zillow|redfin/i.test(source)) return "realtor";
  return "homeowner";
}

// Pick the template for a recipient type. An explicit override id always wins;
// otherwise homeowners get the offer template named for them, realtors get the
// first offer-audience template (the listing-agent cash offer / LOI).
export function pickTemplate(templates = [], recipientType = "homeowner", overrideId = null) {
  if (overrideId) {
    const t = templates.find((t) => t.id == overrideId);
    if (t) return t;
  }
  const offers = templates.filter((t) => t.audience === "offer");
  const wantHome = recipientType === "homeowner";
  return offers.find((t) => wantHome === /homeowner|seller/i.test(t.name || "")) || offers[0] || null;
}

const m$ = (n) => (n || n === 0) && !isNaN(n) ? "$" + Math.round(Number(n)).toLocaleString("en-US") : "";

// Superset of server mergeFields + the client's mergeOffer fields, so any
// existing template renders. cfg: { myName, myPhone, offer, earnest,
// closeDays, inspectionDays, date }. Unknown {{fields}} are left as-is.
export function mergeEmailFields(text, lead = {}, cfg = {}) {
  const cleanName = (lead.seller_name || "").replace(/\(listing agent\)/i, "").trim();
  const first = (cleanName || "there").split(/\s+/)[0] || "there";
  const map = {
    first_name: first,
    seller_name: cleanName, name: cleanName, agent_name: cleanName,
    address: lead.address || "the property",
    city: lead.city || "", state: lead.state || "", zip: lead.zip || "",
    city_clause: lead.city ? ` in ${lead.city}` : "",
    offer: m$(cfg.offer), earnest: m$(cfg.earnest),
    close_days: String(cfg.closeDays ?? ""), inspection_days: String(cfg.inspectionDays ?? ""),
    arv: m$(lead.arv), repairs: m$(lead.repair_estimate), repair_estimate: m$(lead.repair_estimate),
    asking_price: m$(lead.asking_price), contract_price: m$(lead.contract_price),
    assignment_fee: m$(lead.assignment_fee),
    date: cfg.date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    my_name: cfg.myName || "", my_phone: cfg.myPhone || "",
  };
  return (text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}

// The one place that decides whether a lead is ready for the emailer:
// has an email on file, a price to offer, and no offer already out.
export function emailReady(lead = {}) {
  return Boolean(
    lead.seller_email && String(lead.seller_email).trim() &&
    !lead.offer_sent_at &&
    Number(lead.offer_amount || lead.mao) > 0 &&
    lead.stage !== "Dead" && lead.stage !== "Closed",
  );
}
