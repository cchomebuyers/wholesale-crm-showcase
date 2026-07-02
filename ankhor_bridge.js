// ankhor_bridge.js — CRM thinga → ankhor88 ThingaImportV2 (path (a) of
// dev/ankhor88-crm-compatibility.md).
//
// Maps rows from the CRM's `thingas` table (ankhor.v1: id/kind/name/version/
// content/axes/category_path — thinga.js) into the ThingaImportV2 payload
// ankhor88 already imports (ankhor88_remix/src/utils/importSchemas/
// thingaImportV2.ts: {$schema:'ThingaImportV2', categories[], thingas[]}).
// Zero ankhor core edits: this speaks a format its registry already detects.
//
// Type mapping keeps ankhor's closed ThingaType union happy:
//   lead  → 'task'  (actionable; stage → task.status)
//   *     → 'note'  (lossless: full CRM payload in facets.note.content JSON)
//
// COMPLIANCE: seller/owner contact fields are REDACTED by default — ankhor88
// has no DNC/consent gate, and this project's rule is deny-until-checked
// (compliance_gate.js). Pass {withContacts:true} only for operator-side use.

export const CONTACT_FIELDS = [
  "seller_phone", "seller_email", "owner_phone", "owner_email",
  "phone", "email", "listing_agent_phone", "listing_agent_email",
];

// CRM pipeline stage → ankhor task.status (closed enum in thingaImportV2.ts)
const STAGE_STATUS = {
  "New": "pending", "Contacted": "in_progress", "Follow-Up": "in_progress",
  "Offer Made": "in_progress", "Under Contract": "in_progress",
  "Assigned": "completed", "Closed": "completed", "Dead": "blocked",
};

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function redactContent(content, withContacts) {
  if (withContacts) return content;
  const out = { ...content };
  for (const f of CONTACT_FIELDS) {
    if (out[f] != null && out[f] !== "") out[f] = "[redacted:contact]";
  }
  return out;
}

// "Pipeline/New" → "CRM > Pipeline > New" (ankhor's ' > ' path delimiter)
export function toAnkhorCategoryPath(categoryPath) {
  const parts = String(categoryPath || "Uncategorized").split("/").map((p) => p.trim()).filter(Boolean);
  return ["CRM", ...parts].join(" > ");
}

// One CRM thinga row → one ImportV2Thinga.
export function crmThingaToImportV2Thinga(row, opts = {}) {
  const withContacts = !!opts.withContacts;
  const content = redactContent(parse(row.content, {}), withContacts);
  const axes = parse(row.axes, {});
  // Lossless payload: everything ankhor's flat row can't hold rides in the
  // note facet as JSON (links/parents/children/tags survive round-trips).
  const payload = {
    id: row.id, kind: row.kind, version: row.version,
    content,
    tags: axes.tags || [], links: axes.links || [],
    parents: axes.parents || [], children: (axes.children || []).slice(0, 50),
  };
  const isLead = row.kind === "lead";
  const t = {
    $type: isLead ? "task" : "note",
    title: String(row.name || row.id).slice(0, 300),
    category_path: toAnkhorCategoryPath(row.category_path || row.kind),
    description: `CRM ${row.kind} · ${row.id}`,
    facets: {},
  };
  if (isLead) {
    t.facets.task = { status: STAGE_STATUS[content.stage] || "pending", priority: content.stage === "Under Contract" ? "high" : "normal" };
    t.facets.note = { content: JSON.stringify(payload) };
  } else {
    t.facets.note = { content: JSON.stringify(payload) };
  }
  return t;
}

// Rows → the full ThingaImportV2 document (categories derived, deduped).
export function buildThingaImportV2(rows, opts = {}) {
  const thingas = [];
  const catSet = new Set();
  for (const row of rows) {
    if (row.kind === "setting") continue; // never export settings (key presence lives there)
    const t = crmThingaToImportV2Thinga(row, opts);
    thingas.push(t);
    catSet.add(t.category_path);
  }
  const categories = [...catSet].sort().map((full) => {
    const parts = full.split(" > ");
    return { name: parts[parts.length - 1], parent_path: parts.length > 1 ? parts.slice(0, -1).join(" > ") : null };
  });
  // Parent categories must exist too (ankhor creates by path) — add missing ancestors.
  const have = new Set(categories.map((c) => (c.parent_path ? c.parent_path + " > " : "") + c.name));
  for (const c of [...categories]) {
    let p = c.parent_path;
    while (p) {
      if (!have.has(p)) {
        const parts = p.split(" > ");
        categories.push({ name: parts[parts.length - 1], parent_path: parts.length > 1 ? parts.slice(0, -1).join(" > ") : null });
        have.add(p);
      }
      p = p.includes(" > ") ? p.slice(0, p.lastIndexOf(" > ")) : null;
    }
  }
  return {
    $schema: "ThingaImportV2",
    categories,
    thingas,
    metadata: { source: "wholesale-crm ankhor_bridge", version: 1, contacts_redacted: !opts.withContacts },
  };
}
