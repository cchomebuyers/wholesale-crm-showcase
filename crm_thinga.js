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

// Mount the substrate and register the CRM's schemas + handlers. Returns the store.
export function mountCrmSubstrate(db, { handlers = {} } = {}) {
  const store = createThingaStore(db);

  // ankhor.v1.lead — the ONE gate. A kind:lead may never be a sold record (those are comps).
  store.registerSchema("ankhor.v1.lead", (content) => {
    const st = String(content.status || content.stage || "").toLowerCase();
    if (SOLD.has(st)) return "sold/closed records are comps (kind:comps), never leads";
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

// The children of a lead Thinga (activities + messages), via the reverse-link index.
// A child may connect by multiple edge kinds (child_of + sent_to) — dedupe to one Thinga.
export function childrenOfLead(store, leadId) {
  const id = leadThingaId(leadId);
  const ids = [...new Set(store.incomingLinks(id).map((l) => l.from_id))];
  return ids.map((fid) => store.get(fid)).filter(Boolean);
}
