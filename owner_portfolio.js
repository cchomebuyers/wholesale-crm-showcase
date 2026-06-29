// owner_portfolio.js -- detect portfolio owners: one owner holding MULTIPLE distressed
// properties. For a wholesaler this is gold -- a tired landlord / investor with several
// vacant or cited buildings is a motivated BULK seller (one conversation, many deals).
//
// CLAUDE-B scoring lane (extends property_score.js / property_signals.js). Pure, no I/O.
// Two rules that make the signal real instead of noise:
//   - normalize owner names so "ONLY PROPERTIES, LLC" and "ONLY PROPERTIES LLC" are one owner;
//   - EXCLUDE institutional/govt owners (Board of Ed, Transit, Land Bank) and placeholder
//     strings ("TAXPAYER OF", "NAME NOT ON FILE") -- those repeat but are not sellers.

import { isInstitutionalOwner, isEntityOwner } from "./property_signals.js";

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Entity suffix spellings collapsed to a canonical token so variants group together.
const SUFFIX_CANON = [
  [/\bL\.?\s*L\.?\s*C\.?\b/g, "LLC"],
  [/\bL\.?\s*P\.?\b/g, "LP"],
  [/\bINC\.?\b/g, "INC"],
  [/\bCORP\.?(ORATION)?\b/g, "CORP"],
  [/\bCO\.?\b/g, "CO"],
  [/\bLTD\.?\b/g, "LTD"],
];

const PLACEHOLDER_RX = /^(TAXPAYER( OF)?|NAME NOT ON FIL(E)?|UNAVAILABLE OWNER|UNKNOWN( OWNER)?|NO NAME( ON FILE)?|OWNER|CURRENT OWNER|N\/?A)$/i;

// Truncation-tolerant non-seller filter (county rolls abbreviate: "HSING AUTHORTI",
// "AUTHOR", "BD OF ED"). Augments property_signals.isInstitutionalOwner without editing that
// shared module. Religious/education/medical/govt bulk holders are not wholesale sellers.
// Leading \b only (no trailing): county rolls truncate, so "UNIVERSIT" must match "UNIVERSITY"
// and "AUTHOR" must match "AUTHORTI"/"AUTHORITY".
const NON_SELLER_RX = /\b(AUTHOR|HOUSING|HSING|BISHOP|DIOCESE|ARCHDIOCESE|CHURCH|MINISTR|PARISH|UNIVERSIT|COLLEGE|SCHOOL|BD OF ED|BOARD OF ED|HOSPITAL|MEDICAL|HEALTH|CHARIT|FOUNDATION|LAND BANK|REDEVELOP|PARK DIST|VILLAGE OF|TOWN OF|TOWNSHIP|GOVERNMENT|RAILROAD|RAILWAY|UTILIT|CEMETER)/i;

export function normalizeOwner(name) {
  let s = str(name).toUpperCase();
  if (!s) return "";
  s = s.replace(/[.,]/g, " ");
  for (const [rx, canon] of SUFFIX_CANON) s = s.replace(rx, canon);
  s = s.replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

export function isPlaceholderOwner(name) {
  return PLACEHOLDER_RX.test(str(name).toUpperCase().replace(/[.,]/g, "").trim());
}

// detectPortfolios(rows, {minSize}) -> ranked array of real private portfolios.
// rows: [{ id, owner_name, address, state, ... }]. Skips institutional + placeholder owners.
export function detectPortfolios(rows = [], { minSize = 2 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const raw = str(r.owner_name);
    if (!raw || isPlaceholderOwner(raw) || isInstitutionalOwner(raw) || NON_SELLER_RX.test(raw)) continue;
    const key = normalizeOwner(raw);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { normalized: key, display: raw, entity: isEntityOwner(raw), count: 0, property_ids: [], states: new Set() });
    const g = groups.get(key);
    g.count += 1;
    if (r.id !== undefined) g.property_ids.push(r.id);
    if (r.state) g.states.add(str(r.state));
  }
  return [...groups.values()]
    .filter((g) => g.count >= minSize)
    .map((g) => ({ ...g, states: [...g.states] }))
    .sort((a, b) => b.count - a.count || a.normalized.localeCompare(b.normalized));
}

// Per-property portfolio bump: being one of a private owner's multiple distressed holdings is a
// motivation signal. Capped so it complements (not dominates) the property grade.
export function portfolioSignal(count) {
  const n = Number(count) || 0;
  if (n >= 5) return { points: 12, label: "large private portfolio (5+ distressed)" };
  if (n >= 3) return { points: 8, label: "private portfolio (3-4 distressed)" };
  if (n >= 2) return { points: 5, label: "small private portfolio (2 distressed)" };
  return { points: 0, label: "single property" };
}
