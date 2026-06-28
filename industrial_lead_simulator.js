// industrial_lead_simulator.js -- failure simulation for the industrial lead machine.
//
// The point is to catch the mistakes this system is likely to make before it
// costs money: duplicate properties, non-owner phones, blank sale status,
// public facility/operator records treated as owners, and outreach before
// compliance clears.

import {
  makeRealEstateFacetedThinga,
  mergeRealEstateThingas,
  parseRealEstateThinga,
  sameRealEstateProperty,
} from "./real_estate_facets.js";

export const INDUSTRIAL_FAILURES = {
  DUPLICATE_PROPERTY: "duplicate_property",
  CONTACT_NOT_OWNER: "contact_not_owner",
  NOT_FOR_SALE: "not_for_sale",
  NO_OWNER: "no_owner",
  NO_CONTACT: "no_contact",
  COMPLIANCE_BLOCK: "compliance_block",
  WEAK_DISTRESS: "weak_distress",
};

function parsed(thinga) {
  return parseRealEstateThinga(thinga, { mode: "strict" }).parsed;
}

export function simulateIndustrialLead(records = []) {
  const thingas = records.map((r) => makeRealEstateFacetedThinga(r));
  const failures = [];
  const merges = [];

  for (let i = 0; i < thingas.length; i++) {
    const t = thingas[i];
    const p = parsed(t);

    if (p.inference.sale_status !== "active" && t.$header.type === "listing") {
      failures.push({
        type: INDUSTRIAL_FAILURES.NOT_FOR_SALE,
        thinga_id: t.$header.id,
        fix: "Require listing.sale_status active before routing to for-sale outreach.",
      });
    }

    if (!p.owner || !p.owner.owner_name) {
      failures.push({
        type: INDUSTRIAL_FAILURES.NO_OWNER,
        thinga_id: t.$header.id,
        fix: "Run assessor/tax-roll/recorder owner-resolution before seller outreach.",
      });
    }

    if (!p.contact || p.contact.contactability !== "has_contact") {
      failures.push({
        type: INDUSTRIAL_FAILURES.NO_CONTACT,
        thinga_id: t.$header.id,
        fix: "Run public-contact connectors, then paid skip-trace only if score is high.",
      });
    } else if (p.contact.contact_relation !== "owner") {
      failures.push({
        type: INDUSTRIAL_FAILURES.CONTACT_NOT_OWNER,
        thinga_id: t.$header.id,
        fix: "Do not treat this as owner phone; keep relation and run owner-resolution.",
      });
    }

    if (!p.compliance || !p.compliance.allowed_to_call) {
      failures.push({
        type: INDUSTRIAL_FAILURES.COMPLIANCE_BLOCK,
        thinga_id: t.$header.id,
        fix: "Create outreach task only after DNC/consent/compliance gate clears.",
      });
    }

    if (p.distress && !p.distress.primary && (!p.distress.signals || !p.distress.signals.length)) {
      failures.push({
        type: INDUSTRIAL_FAILURES.WEAK_DISTRESS,
        thinga_id: t.$header.id,
        fix: "Do not rank high without a concrete distress signal, valuation gap, or active listing event.",
      });
    }

    for (let j = i + 1; j < thingas.length; j++) {
      const same = sameRealEstateProperty(t, thingas[j]);
      if (same.same) {
        merges.push({
          a: t.$header.id,
          b: thingas[j].$header.id,
          merge_keys: same.matches,
          merged: mergeRealEstateThingas(t, thingas[j]),
        });
        failures.push({
          type: INDUSTRIAL_FAILURES.DUPLICATE_PROPERTY,
          thinga_id: t.$header.id,
          other_thinga_id: thingas[j].$header.id,
          fix: "Merge into one parent property Thinga and preserve both source records as children.",
        });
      }
    }
  }

  return { thingas, failures, merges };
}

export function summarizeSimulation(sim) {
  const counts = {};
  for (const f of sim.failures || []) counts[f.type] = (counts[f.type] || 0) + 1;
  return {
    thingas: sim.thingas.length,
    failures: sim.failures.length,
    merges: sim.merges.length,
    counts,
    top_fixes: [...new Set((sim.failures || []).map((f) => f.fix))],
  };
}

