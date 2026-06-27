// contact_router.js — goal-driven, multi-route contact/identity finder.
//
// The principle (from CONTACT_ROUTE_ENGINE thinking): finding a phone is NOT one call — it's a
// pathfinder. Given a subject (address + owner/business name), we fan across EVERY free
// `public-contact` connector in the registry first, collect candidates with provenance, and only
// escalate to paid skip-trace or a research agent when the free routes come up empty.
//
// Config-driven: any connector with `type:"public-contact"` and a `search()` is auto-included.
// Adding a new free phone source = adding a connector. No change here.
//
// HONEST COMPLIANCE: a returned phone is NOT automatically callable. Every candidate is marked
// outreach_allowed:false / compliance:"unchecked" until a DNC/consent gate clears it. We never
// claim a number is safe to dial.

const streetOf = (addr) => (addr || "").split(",")[0].trim();

// Rank: public-official phone > public-official email > anything else; high confidence first.
function scoreCandidate(c) {
  let s = 0;
  if (c.phone) s += 100;
  if (c.email) s += 40;
  if (c.confidence === "high") s += 20;
  else if (c.confidence === "medium") s += 10;
  if (c.legal_status === "public_official_api") s += 15;
  return s;
}

// Find contact candidates for a subject across all free public-contact connectors.
//   subject: { address, owner_name, business_name, city, state, zip }
//   opts:    { batchdataKey, registry }  (registry: id -> connector)
// Returns { subject, candidates[], routesTried[], freePhoneCount, freeEmailCount, nextStep, escalation }.
export async function findContact(registry, subject = {}, opts = {}) {
  const name = subject.business_name || subject.owner_name || null;
  const street = streetOf(subject.address);
  const geo = { city: subject.city || undefined, state: subject.state || undefined, zip: subject.zip || undefined };

  // Search MULTIPLE ways, in order of precision: name-only first (highest recall on business
  // datasets), then address-only as a fallback. Over-constraining (name AND full address) misses hits.
  const subtargets = [];
  if (name) subtargets.push({ business_name: name, owner_name: subject.owner_name || undefined, ...geo });
  if (street) subtargets.push({ address: street, ...geo });

  const connectors = Object.values(registry || {}).filter(
    (c) => c && c.type === "public-contact" && typeof c.search === "function",
  );

  const routesTried = [];
  const raw = [];
  for (const conn of connectors) {
    routesTried.push(conn.id);
    for (const st of subtargets) {
      try {
        const results = await conn.search(st);
        const hits = (results || []).filter((r) => r && (r.phone || r.email));
        if (hits.length) { raw.push(...hits); break; } // got contacts here — stop trying this source
      } catch { /* a failing source never breaks the route */ }
    }
  }

  // Dedup by phone (fallback email), keep the highest-scoring instance.
  const byKey = new Map();
  for (const r of raw) {
    const key = (r.phone || r.email || "").toString();
    if (!key) continue;
    const cand = {
      phone: r.phone || null,
      email: r.email || null,
      name: r.business_name || r.dba_name || r.owner_name || null,
      source_id: r.source_id,
      source_type: r.source_type || null,
      address: r.address || null,
      confidence: r.confidence || "low",
      legal_status: r.legal_status || "unknown",
      // honest: this entity may be the business/operator/agent, not the deed owner
      relation: r.is_confirmed_owner ? "owner" : "business_or_operator",
      // honest compliance posture — never claim it's callable
      outreach_allowed: false,
      compliance_status: "unchecked",
      compliance_note: "DNC/consent not verified. Check before any call/SMS.",
    };
    const prev = byKey.get(key);
    if (!prev || scoreCandidate(cand) > scoreCandidate(prev)) byKey.set(key, cand);
  }

  const candidates = [...byKey.values()].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const freePhoneCount = candidates.filter((c) => c.phone).length;
  const freeEmailCount = candidates.filter((c) => c.email && !c.phone).length;

  // Escalation ladder — what to do when free routes don't fully answer.
  let nextStep, escalation;
  if (freePhoneCount > 0) {
    nextStep = "free_public_phone_found";
    escalation = null;
  } else if (opts.batchdataKey) {
    nextStep = "paid_skiptrace_available";
    escalation = { route: "batchdata-skiptrace", cost: "per-hit", needs: "owner_name + address" };
  } else {
    nextStep = "no_free_contact";
    escalation = {
      route: "research_agent_or_add_key",
      options: [
        "Add a BatchData key to enable paid skip-trace from address.",
        "Dispatch a research agent (LLC→Secretary of State→registered agent; permit/license datasets).",
      ],
    };
  }

  return { subject, candidates, routesTried, freePhoneCount, freeEmailCount, nextStep, escalation };
}
