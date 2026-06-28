// property_signals.js -- derive real wholesale motivation signals from a property's
// own fields, instead of grading every record by its source. Now that owner-join fills
// owner_name + owner_mailing, the highest-value free signals are:
//   - absentee owner   (mailing address != property address)  -> classic motivated seller
//   - entity owner      (LLC/Trust/LP/etc.)                    -> investor/tired landlord (or a buyer)
//   - institutional     (city/county/authority/transit/bank)  -> NOT a seller lead
// Pure: no I/O. Consumed by pro_wholesaler_queue.js to differentiate otherwise-identical
// per-source scores and to rank which records to skip-trace first.

const ENTITY_RX = /\b(LLC|L\.?L\.?C|INC|CORP|CO|COMPANY|LP|LLP|LTD|TRUST|HOLDINGS?|PROPERTIES|PROPERTY|VENTURES?|CAPITAL|GROUP|REALTY|ENTERPRISES?|PARTNERS|ASSOCIATES|MGMT|MANAGEMENT|HOMES|INVESTMENTS?|FUND|ESTATES?)\b/i;
const INSTITUTIONAL_RX = /\b(CITY OF|COUNTY OF|STATE OF|AUTHORITY|AUTHOR$|TRANSIT|PARK DISTRICT|DEPARTMENT|DEPT OF|BOARD OF|HOUSING AUTH|REDEVELOPMENT|MUNICIPAL|FEDERAL|U\.?S\.?A?\b|UNITED STATES|DEPT|SCHOOL DISTRICT|CHICAGO TRANSIT)\b/i;
const LENDER_RX = /\b(BANK|MORTGAGE|N\.?A\.?$|FANNIE MAE|FREDDIE MAC|HUD|CITIBANK|WELLS FARGO|CHASE|US BANK|FINANCIAL|LOAN)\b/i;

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Reduce an address to a comparable core: house number + first street-name word(s),
// dropping unit/apt, directionals, and street-type suffixes/truncation.
const SUFFIX = /\b(ST|STR|STREET|AVE?|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|LN|LANE|PL|PLACE|CT|COURT|PKWY|PARKWAY|HWY|TER|TERR|TERRACE|CIR|SQ|PLZ|PLAZA|WAY)\b/gi;
const DIR = /\b(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\b/gi;

export function addrCore(addr) {
  let s = str(addr).toUpperCase();
  if (!s) return "";
  s = s.split(",")[0];
  s = s.replace(/(APT|UNIT|STE|#|FL|FLOOR|RM)\b.*$/i, "");
  s = s.replace(/[.#,]/g, " ");
  const houseMatch = s.match(/^\s*(\d+)/);
  const house = houseMatch ? houseMatch[1] : "";
  let rest = s.replace(/^\s*\d+(-\d+)?/, " ");
  rest = rest.replace(SUFFIX, " ").replace(DIR, " ").replace(/\s+/g, " ").trim();
  const firstWord = rest.split(" ").filter(Boolean)[0] || "";
  return `${house} ${firstWord}`.trim();
}

export function isEntityOwner(name) { return ENTITY_RX.test(str(name)); }
export function isInstitutionalOwner(name) { return INSTITUTIONAL_RX.test(str(name)) || LENDER_RX.test(str(name)); }

export function deriveSignals(property = {}) {
  const owner = str(property.owner_name);
  const ownerKnown = owner.length > 1;
  const entity = ownerKnown && isEntityOwner(owner);
  const institutional = ownerKnown && isInstitutionalOwner(owner);

  // absentee: only decidable when we have both a property address and an owner mailing.
  let absentee = null;
  const propCore = addrCore(property.address || property.formatted_address);
  const mailCore = addrCore(property.owner_mailing);
  if (ownerKnown && propCore && mailCore) absentee = propCore !== mailCore;

  const reasons = [];
  let signal_score = 0;
  if (ownerKnown) { signal_score += 15; reasons.push("owner of record known"); }
  if (absentee === true) { signal_score += 25; reasons.push("absentee owner (mailing != property)"); }
  if (entity && !institutional) { signal_score += 10; reasons.push("entity owner (LLC/Trust/LP — investor/tired landlord)"); }
  if (institutional) { signal_score -= 50; reasons.push("institutional/govt/lender owner — not a seller lead"); }

  return {
    owner_known: ownerKnown,
    entity_owner: !!entity,
    institutional_owner: !!institutional,
    absentee_owner: absentee,
    owner_occupied: absentee === false,
    signal_score,
    reasons,
  };
}
