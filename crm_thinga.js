// crm_thinga.js — mount the Ankhor substrate onto the live CRM database.
//
// Non-destructive: the `thingas` tables live ALONGSIDE the existing eleven (server.js:30-140).
// This is the interop seam from dev/plans/6-26-26/01-SUBSTRATE.md — the CRM keeps working while
// rows are mirrored into Thingas. The lead spec ("on/off-market, never sold, contact-or-research")
// is enforced here as `schema: ankhor.v1.lead` so the rule lives in ONE place, substrate-wide.

import { createThingaStore } from "./thinga.js";

const SOLD = new Set(["sold", "closed"]);
const isSold = (row) =>
  SOLD.has(String(row.stage || "").toLowerCase()) || SOLD.has(String(row.status || "").toLowerCase());
const hasContact = (row) => Boolean((row.seller_phone || "").trim() || (row.seller_email || "").trim());

// Where a lead lives in the wayfinding tree (Ankhor §7.3) — encodes the spec as a path.
export function leadCategoryPath(row) {
  if (isSold(row)) return "Comps";                          // sold → comps, never a lead
  if (!hasContact(row)) return "Prospects/pending_research"; // no contact → research queue, never dropped
  return `Pipeline/${row.stage || "New"}`;
}

// Map a CRM `leads` row to a Thinga (kind:lead, or kind:comps if it's a closed sale).
export function leadToThinga(row) {
  const sold = isSold(row);
  return {
    id: `thinga:lead-${row.id}`,            // stable id derived from the row → idempotent mirror
    kind: sold ? "comps" : "lead",
    name: row.address || row.seller_name || `lead ${row.id}`,
    schema: sold ? null : "ankhor.v1.lead", // comps don't carry the lead schema
    category_path: leadCategoryPath(row),
    content: {
      crm_id: row.id, stage: row.stage, status: row.status ?? null,
      seller_name: row.seller_name, seller_phone: row.seller_phone, seller_email: row.seller_email,
      address: row.address, city: row.city, state: row.state, zip: row.zip,
      arv: row.arv, mao: row.mao, repair_estimate: row.repair_estimate,
      asking_price: row.asking_price, assignment_fee: row.assignment_fee,
      motivation: row.motivation, source: row.source,
    },
    tags: [row.source, row.motivation].filter(Boolean),
  };
}

// Stable Thinga id for a CRM lead row id — so children can reference their parent deterministically.
export const leadThingaId = (leadId) => `thinga:lead-${leadId}`;

// An activity (note/call/stage_change/skiptrace/email log) → a child Thinga of its lead.
export function activityToThinga(row) {
  return {
    id: `thinga:activity-${row.id}`,
    kind: "activity",
    name: row.type || "note",
    parents: [leadThingaId(row.lead_id)],          // containment → reverse index records child_of
    content: { crm_id: row.id, type: row.type, body: row.body, lead_id: row.lead_id },
    created_at: row.created_at,
  };
}

// An email (inbound or outbound) → a message Thinga linked to the lead it threads to.
export function emailToThinga(row) {
  const linkKind = row.direction === "in" ? "received_from" : "sent_to";
  const links = row.lead_id ? [{ kind: linkKind, to: leadThingaId(row.lead_id) }] : [];
  return {
    id: `thinga:email-${row.id}`,
    kind: "message",
    name: row.subject || "(no subject)",
    parents: row.lead_id ? [leadThingaId(row.lead_id)] : [],
    links,
    content: {
      crm_id: row.id, direction: row.direction, subject: row.subject, snippet: row.snippet,
      from_addr: row.from_addr, to_addr: row.to_addr, msg_date: row.msg_date, lead_id: row.lead_id,
    },
  };
}

// A task (follow-up/reminder) → a child Thinga of its lead (or a free-floating task if lead-less).
export function taskToThinga(row) {
  return {
    id: `thinga:task-${row.id}`,
    kind: "task",
    name: row.title || "task",
    parents: row.lead_id ? [leadThingaId(row.lead_id)] : [],
    due_date: row.due_date || null,
    category_path: row.done ? "Tasks/Done" : "Tasks/Open",
    content: { crm_id: row.id, title: row.title, done: Boolean(row.done), lead_id: row.lead_id ?? null },
  };
}

// A day-note → a calendar note Thinga (day_notes is keyed by day, not a numeric id).
export function noteToThinga(row) {
  return {
    id: `thinga:note-${row.day}`,
    kind: "note",
    name: row.day,
    due_date: row.day,
    category_path: `Calendar/${row.day}`,
    content: { day: row.day, body: row.body },
  };
}

// A notification → a notification Thinga, linked to the property it's about (if any).
export function notificationToThinga(row) {
  return {
    id: `thinga:notification-${row.id}`,
    kind: "notification",
    name: row.title || row.type || "notification",
    links: row.property_id ? [{ kind: "about", to: `thinga:property-${row.property_id}` }] : [],
    category_path: row.read ? "Notifications/Read" : "Notifications/Unread",
    content: { crm_id: row.id, type: row.type, title: row.title, body: row.body, read: Boolean(row.read) },
  };
}

// A cash buyer → a buyer Thinga carrying its buy-box (areas/types/max price).
export function buyerToThinga(row) {
  return {
    id: `thinga:buyer-${row.id}`,
    kind: "buyer",
    name: row.name || `buyer ${row.id}`,
    category_path: "Buyers",
    tags: String(row.areas || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    content: {
      crm_id: row.id, name: row.name, phone: row.phone, email: row.email,
      areas: row.areas, property_types: row.property_types, max_price: row.max_price,
      cash: row.cash == null ? 1 : Number(row.cash), notes: row.notes,
    },
  };
}

// An email template → a template Thinga (filed by audience).
export function templateToThinga(row) {
  return {
    id: `thinga:template-${row.id}`,
    kind: "template",
    name: row.name || "Untitled",
    category_path: `Templates/${row.audience || "leads"}`,
    content: { crm_id: row.id, name: row.name, subject: row.subject, body: row.body, audience: row.audience || "leads" },
  };
}

// Secrets never enter the substrate — keys matching this are skipped by mirrorSetting.
export const isSensitiveSetting = (key) => /password|api_key|token|secret/i.test(String(key || ""));

// A key/value setting → a setting Thinga (non-secret only).
export function settingToThinga(key, value) {
  return {
    id: `thinga:setting-${key}`,
    kind: "setting",
    name: key,
    category_path: "Settings",
    content: { key, value },
  };
}

// A scanned property → a property Thinga (scores/ARV/MAO), linked to its campaign + imported lead.
export function propertyToThinga(row) {
  const links = [];
  if (row.campaign_id) links.push({ kind: "found_by", to: `thinga:campaign-${row.campaign_id}` });
  if (row.imported_lead_id) links.push({ kind: "imported_to", to: `thinga:lead-${row.imported_lead_id}` });
  return {
    id: `thinga:property-${row.id}`,
    kind: "property",
    name: row.formatted_address || row.address || `property ${row.id}`,
    category_path: `Acquisitions/${row.review_status || "New"}`,
    links,
    content: {
      crm_id: row.id, address: row.formatted_address || row.address, city: row.city, state: row.state, zip: row.zip,
      property_type: row.property_type, bedrooms: row.bedrooms, bathrooms: row.bathrooms,
      square_footage: row.square_footage, year_built: row.year_built,
      status: row.status, price: row.price, days_on_market: row.days_on_market,
      lead_score: row.lead_score, motivation_score: row.motivation_score, distress_score: row.distress_score,
      wholesale_score: row.wholesale_score, arv: row.arv, mao: row.mao, spread: row.spread,
      equity: row.equity, rent_estimate: row.rent_estimate, crime_shootings_30d: row.crime_shootings_30d,
      listing_agent_name: row.listing_agent_name, listing_agent_phone: row.listing_agent_phone,
      source: row.source, source_id: row.source_id,
    },
  };
}

// A campaign → a CODE Thinga: its filters are content, its run is a registered handler, and an
// active campaign recurs (the auto-scan). INVOKE thinga:campaign-N runs it (handler set in server.js).
export function campaignToThinga(row) {
  return {
    id: `thinga:campaign-${row.id}`,
    kind: "campaign",
    name: row.name || `campaign ${row.id}`,
    category_path: row.active ? "Campaigns/Active" : "Campaigns/Paused",
    code: { handler: "run_campaign" },
    recurrence: row.active ? { pattern: "daily" } : null,
    content: {
      crm_id: row.id, name: row.name, active: Number(row.active),
      city: row.city, state: row.state, zip: row.zip, property_type: row.property_type, status: row.status,
      price_min: row.price_min, price_max: row.price_max, beds_min: row.beds_min, baths_min: row.baths_min,
      sqft_min: row.sqft_min, days_on_market_min: row.days_on_market_min,
      last_run: row.last_run, last_count: row.last_count,
    },
  };
}

// A saved ecosystem search plan is still the same Thinga shape: kind changes, axes do not.
// Children are discovered through the reverse-link index from records whose parents include this plan id.
export const planThingaId = (planId) => `thinga:plan-${String(planId || "all-enabled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all-enabled"}`;

export function planToThinga(plan) {
  return {
    id: planThingaId(plan.id),
    kind: "plan",
    name: plan.name || plan.id || "Search plan",
    schema: "ankhor.v1.plan",
    category_path: "Plans/Search",
    content: {
      id: plan.id,
      description: plan.description || "",
      includeConnectorIds: plan.includeConnectorIds || [],
      excludeConnectorIds: plan.excludeConnectorIds || [],
      includeSourceTypes: plan.includeSourceTypes || [],
      excludeSourceTypes: plan.excludeSourceTypes || [],
      includeGroups: plan.includeGroups || [],
      maxConnectors: plan.maxConnectors ?? null,
      costPolicy: plan.costPolicy || "free_first",
      participants: plan.participants || [],
      notes: plan.notes || [],
      parser_family: "realEstate.faceted.v1",
    },
    tags: ["search-plan", plan.costPolicy || "free_first"].filter(Boolean),
  };
}

// Mount the substrate and register the CRM's schemas + handlers. Returns the store.
export function mountCrmSubstrate(db, { handlers = {} } = {}) {
  const store = createThingaStore(db);

  // ankhor.v1.lead — the ONE gate. A kind:lead may never be a sold record (those are comps).
  store.registerSchema("ankhor.v1.lead", (content) => {
    const st = String(content.status || content.stage || "").toLowerCase();
    if (SOLD.has(st)) return "sold/closed records are comps (kind:comps), never leads";
    return true;
  });
  store.registerSchema("ankhor.v1.plan", (content) => {
    if (!content.id) return "plan requires an id";
    return true;
  });

  // Native handlers (no eval) — the CRM's pure functions become code Thingas (01-SUBSTRATE §4).
  // Injected by server.js so this module stays decoupled from Express/route bodies.
  for (const [name, fn] of Object.entries(handlers)) store.registerHandler(name, fn);

  return store;
}

// Idempotently mirror one CRM lead row into the substrate. Safe to call on every create/update.
export function mirrorLead(store, row) {
  return store.put(leadToThinga(row));
}
export function mirrorActivity(store, row) {
  return store.put(activityToThinga(row));
}
export function mirrorEmail(store, row) {
  return store.put(emailToThinga(row));
}
export function mirrorTask(store, row) {
  return store.put(taskToThinga(row));
}
export function mirrorNote(store, row) {
  return store.put(noteToThinga(row));
}
export function mirrorNotification(store, row) {
  return store.put(notificationToThinga(row));
}
export function mirrorBuyer(store, row) {
  return store.put(buyerToThinga(row));
}
export function mirrorTemplate(store, row) {
  return store.put(templateToThinga(row));
}
// Returns the Thinga id, or null if the setting is sensitive (secrets are never mirrored).
export function mirrorSetting(store, key, value) {
  if (isSensitiveSetting(key)) return null;
  return store.put(settingToThinga(key, value));
}
export function mirrorProperty(store, row) {
  return store.put(propertyToThinga(row));
}
export function mirrorCampaign(store, row) {
  return store.put(campaignToThinga(row));
}
export function mirrorPlan(store, plan) {
  return store.put(planToThinga(plan));
}

// The children of a lead Thinga (activities + messages), via the reverse-link index.
// A child may connect by multiple edge kinds (child_of + sent_to) — dedupe to one Thinga.
export function childrenOfLead(store, leadId) {
  const id = leadThingaId(leadId);
  const ids = [...new Set(store.incomingLinks(id).map((l) => l.from_id))];
  return ids.map((fid) => store.get(fid)).filter(Boolean);
}
