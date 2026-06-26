// connectors/detroit.js — the Detroit open-data connectors (ArcGIS, free, unblocked).
// Wrap the existing pullBlightTickets / detroitComps (injected). These are different `type`s than
// listings — violations (off-market leads) and comps (ARV) — so executeCampaign (listings-only) does
// not fan over them; they're registered as code:connector Thingas and INVOKE-able on their own.

// A Detroit blight ticket → a normalized off-market lead (owner + absentee signal).
export function normalizeBlight(a) {
  const addr = (a.address || "").trim();
  if (!addr) return null;
  const full = `${addr}, Detroit, MI ${a.zip_code || ""}`.trim();
  const ownStreet = (a.property_owner_address || "").toUpperCase().replace(/\s+/g, " ").trim();
  const absentee = ownStreet && ownStreet !== addr.toUpperCase().replace(/\s+/g, " ").trim();
  return {
    addr_key: full.toLowerCase(), source: "detroit-blight",
    seller_name: a.property_owner_name || null, address: full, city: "Detroit", state: "MI", zip: a.zip_code || null,
    motivation: "Code violation",
    ordinance: a.ordinance_description || null, ticket_issued: a.ticket_issued_date || null,
    balance_due: a.amt_balance_due || null, absentee,
  };
}

export function detroitBlightConnector(deps) {
  return {
    id: "detroit-blight", region: "us-mi-wayne", type: "violations",
    async search(c) {
      const days = Math.max(1, Math.min(365, Number(c.days) || 30));
      const tickets = await deps.pullBlightTickets(days);
      return (tickets || []).map(normalizeBlight).filter(Boolean);
    },
  };
}

export function detroitCompsConnector(deps) {
  return {
    id: "detroit-comps", region: "us-mi-wayne", type: "comps",
    async search(c) {
      if (!c.address) return [];
      const comps = await deps.detroitComps(c.address);
      return comps ? [comps] : [];
    },
  };
}
