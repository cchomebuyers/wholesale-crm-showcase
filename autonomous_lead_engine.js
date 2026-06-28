// autonomous_lead_engine.js -- source -> Thinga convergence -> analysis -> council shortlist.
//
// This is the programmatic loop:
// 1. GET from lawful connector sources.
// 2. Normalize each record into a faceted kind:"realEstate" Thinga.
// 3. Merge records that prove the same property by parcel/address/geo identity.
// 4. Analyze score/spend-worthiness.
// 5. Produce a council shortlist: only these should get phone-number spend.

import {
  makeRealEstateFacetedThinga,
  mergeRealEstateThingas,
  parseRealEstateThinga,
  realEstateIdentityKeys,
  sameRealEstateProperty,
} from "./real_estate_facets.js";
import { rankBuyersForProperty, BUYER_DISCOVERY_PATHS } from "./buyer_matching.js";
import { rankBuyerDemand } from "./buyer_discovery.js";
import { selectConnectorsForPlan } from "./ecosystem_search_plan.js";
import { evaluateWholesaleSpread } from "./wholesale_spread.js";

const planThingaId = (planId) => `thinga:plan-${String(planId || "all-enabled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all-enabled"}`;

const LEAD_SOURCE_TYPES = new Set(["listings", "violations", "property", "public-contact", "paid-skiptrace"]);

function usableConnector(conn) {
  if (!conn || typeof conn.search !== "function") return false;
  if (conn.type === "comps" || conn.type === "geocode") return false;
  return LEAD_SOURCE_TYPES.has(conn.type) || !conn.type;
}

function facetedToStoreThinga(t, { planParentId = null } = {}) {
  const header = t.$header || {};
  const parents = [...new Set([...(header.parents || []), ...(planParentId ? [planParentId] : [])])];
  return {
    id: header.id || t.id,
    kind: header.kind || t.kind || "realEstate",
    name: header.name || t.name || t.facets?.property?.address || "realEstate",
    schema: header.schema || t.content?.config_version || "realEstate.facets.v1",
    category_path: header.category_path || t.content?.category_path || "RealEstate",
    parents,
    children: header.children || [],
    links: parents.map((pid) => ({ kind: "child_of_plan", to: pid })),
    content: {
      ...(t.content || {}),
      type: header.type || t.content?.record_type || "property_signal",
      parser_family: "realEstate.faceted.v1",
      parser_schema: header.schema || t.content?.config_version || "realEstate.facets.v1",
      facets: t.facets || {},
      analysis: t.analysis || null,
    },
    tags: [header.type, t.analysis?.tier, t.facets?.source?.source_type].filter(Boolean),
  };
}

function propertyFromFacets(t) {
  const f = t.facets || {};
  return {
    address: f.property?.address,
    formatted_address: f.property?.address,
    city: f.property?.city,
    state: f.property?.state,
    zip: f.property?.zip,
    county: f.property?.county,
    property_type: f.property?.property_type,
    price: f.listing?.price || f.valuation?.price,
    mao: f.valuation?.mao,
  };
}

function propertyIdentityConfidence(f = {}) {
  let n = 0;
  if (f.property?.address || f.property?.addr_key) n += 40;
  if (f.property?.parcel_id) n += 35;
  if (f.property?.latitude != null && f.property?.longitude != null) n += 10;
  if (f.source?.source_row_id) n += 10;
  if (f.property?.city && f.property?.state) n += 5;
  return Math.min(100, n);
}

function ownerIdentityConfidence(f = {}) {
  let n = 0;
  if (f.owner?.owner_name || f.property?.owner_name || f.property?.seller_name) n += 45;
  if (f.owner?.owner_mailing_address) n += 25;
  if (f.owner?.owner_source) n += 15;
  if (f.owner?.owner_type && f.owner.owner_type !== "unknown") n += 10;
  if (f.contact?.contact_relation === "owner") n += 15;
  return Math.min(100, n);
}

function contactConfidence(f = {}) {
  const c = f.contact || {};
  const hasPhone = Boolean(c.phone || c.seller_phone || c.listing_agent_phone);
  const hasEmail = Boolean(c.email || c.seller_email || c.listing_agent_email);
  if (!hasPhone && !hasEmail) return 0;
  const relationScore = {
    owner: 85,
    registered_agent: 70,
    responsible_party: 60,
    operator: 45,
    tenant: 35,
    agent: 30,
    unknown: 20,
  };
  let n = relationScore[c.contact_relation] ?? 20;
  if (hasPhone) n += 10;
  if (hasEmail) n += 5;
  if (c.phone_source) n += 5;
  return Math.min(100, n);
}

function sourceConfidence(f = {}) {
  const source = f.source || {};
  let n = 0;
  if (source.source_id) n += 35;
  if (source.legal_status === "public_official_api") n += 35;
  if (source.source_row_id) n += 15;
  if (source.raw_status) n += 5;
  return Math.min(100, n || 20);
}

function scoreConvergedThinga(t, buyers = [], buyerCandidates = []) {
  const parsed = parseRealEstateThinga(t, { mode: "lenient" });
  const f = t.facets || {};
  const listingStatus = String(f.listing?.sale_status || f.listing?.status || f.property?.status || "").toLowerCase();
  const daysOnMarket = Number(f.listing?.days_on_market || f.property?.days_on_market || 0);
  const distressSignal = f.distress?.primary || f.distress?.distress || f.distress?.motivation || f.distress?.ordinance ||
    (Array.isArray(f.distress?.signals) && f.distress.signals.length ? f.distress.signals.join(", ") : null);
  const ownerName = f.owner?.owner_name || f.owner?.seller_name || f.property?.owner_name || f.property?.seller_name;
  const phone = f.contact?.phone || f.contact?.seller_phone || f.contact?.listing_agent_phone ||
    f.property?.phone || f.property?.listing_agent_phone;
  const email = f.contact?.email || f.contact?.seller_email || f.contact?.listing_agent_email ||
    f.property?.email || f.property?.listing_agent_email;
  const contactRelation = f.contact?.contact_relation || f.inference?.contact_relation;
  const propertyConfidence = propertyIdentityConfidence(f);
  const ownerConfidence = ownerIdentityConfidence(f);
  const contactScore = contactConfidence(f);
  const sourceScore = sourceConfidence(f);
  let score = 0;
  const reasons = [];
  const spendBlocks = [];

  if (parsed.success) { score += 10; reasons.push("parsed as realEstate"); }
  if (f.property?.address || f.property?.parcel_id) { score += 20; reasons.push("property identity resolved"); }
  if (listingStatus === "active" || listingStatus === "for sale") { score += 20; reasons.push("active listing signal"); }
  if (daysOnMarket >= 30) { score += 8; reasons.push("days on market suggests motivation"); }
  if (distressSignal) { score += 18; reasons.push("distress signal present"); }
  if (ownerName) { score += 10; reasons.push("owner identity known"); }
  if (phone || email) { score += 12; reasons.push("contact evidence exists"); }
  if (propertyConfidence >= 75) { score += 5; reasons.push("strong property identity"); }
  if (sourceScore >= 70) { score += 4; reasons.push("lawful official source"); }
  if (contactRelation && contactRelation !== "owner") {
    reasons.push("contact is not proven owner contact");
  }
  if (listingStatus === "sold" || listingStatus === "closed" || f.listing?.sale_status === "sold") {
    score = Math.min(score, 15);
    spendBlocks.push("sold/comps record is not a lead");
  }
  if (propertyConfidence < 40) {
    spendBlocks.push("weak property identity");
  }
  if (contactScore >= 90 && contactRelation === "owner") {
    spendBlocks.push("owner contact already exists; validate before paid skiptrace");
  }
  if (!ownerName && !phone && !email) {
    spendBlocks.push("no owner/contact yet");
  }

  const buyerDemand = rankBuyerDemand({
    property: propertyFromFacets(t),
    crmBuyers: buyers,
    discoveredCandidates: buyerCandidates,
    limit: 10,
  });
  const buyerMatches = buyerDemand.all;
  const strongBuyers = buyerMatches.filter((b) => b.score >= 70).length;
  const spread = evaluateWholesaleSpread({
    ...propertyFromFacets(t),
    arv: f.valuation?.arv,
    repair_estimate: f.valuation?.repair_estimate,
    seller_acceptable_price: f.valuation?.seller_acceptable_price || f.valuation?.seller_min_price,
    contract_price: f.valuation?.contract_price,
    offer_amount: f.valuation?.offer_amount,
    acquisition_offer_price: f.valuation?.acquisition_offer_price || f.valuation?.target_acquisition_price,
    assignment_fee: f.valuation?.assignment_fee,
    buyer_assignment_price: f.valuation?.buyer_assignment_price,
    buyer_matches: buyerMatches,
  });
  if (strongBuyers) {
    score += Math.min(15, strongBuyers * 5);
    reasons.push(`${strongBuyers} strong buyer match${strongBuyers === 1 ? "" : "es"}`);
  }
  if (spread.status === "works") {
    score += 15;
    reasons.push(`projected wholesale spread ${spread.projectedSpread}`);
  } else if (spread.status === "fails") {
    score = Math.min(score, 50);
    spendBlocks.push("no projected wholesale spread");
  } else if (spread.status === "thin") {
    score = Math.min(score, 65);
    spendBlocks.push("spread below target fee");
  } else {
    spendBlocks.push(...spread.nextNeeded);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const fatalSpendBlocks = new Set([
    "sold/comps record is not a lead",
    "weak property identity",
    "owner contact already exists; validate before paid skiptrace",
  ]);
  const hasLeadSignal = listingStatus === "active" || listingStatus === "for sale" || Boolean(distressSignal) || strongBuyers > 0;
  const spendAllowed = score >= 75 && hasLeadSignal && !spendBlocks.some((b) => fatalSpendBlocks.has(b));
  return {
    score,
    tier: score >= 75 ? "spend" : score >= 55 ? "council_review" : "hold",
    spend_allowed: spendAllowed,
    spend_blocks: spendBlocks,
    reasons,
    confidence: {
      property: propertyConfidence,
      owner: ownerConfidence,
      contact: contactScore,
      source: sourceScore,
    },
    buyer_matches: buyerMatches,
    buyer_gaps: buyerDemand.gaps,
    spread,
    identity_keys: realEstateIdentityKeys(t),
    parse: parsed,
  };
}

function mergeIntoGraph(graph, thinga) {
  for (let i = 0; i < graph.length; i++) {
    const same = sameRealEstateProperty(graph[i], thinga);
    if (same.same) {
      graph[i] = mergeRealEstateThingas(graph[i], thinga, { requireSame: true });
      return { merged: true, index: i, keys: same.matches };
    }
  }
  graph.push(thinga);
  return { merged: false, index: graph.length - 1, keys: realEstateIdentityKeys(thinga) };
}

export async function runAutonomousLeadCycle({
  registry = {},
  target = {},
  sourceHealth = null,
  thingaStore = null,
  buyers = [],
  buyerCandidates = [],
  sourceLimit = 25,
  resultLimitPerSource = 100,
  shortlistLimit = 25,
  searchPlan = {},
} = {}) {
  const graph = [];
  const sourceRuns = [];
  const rawThingas = [];
  const planInput = {
    ...searchPlan,
    maxConnectors: searchPlan.maxConnectors ?? (sourceLimit == null ? null : sourceLimit),
  };
  const selected = selectConnectorsForPlan(registry, planInput);
  const connectors = selected.connectors.filter(usableConnector);
  const planParentId = planThingaId(selected.plan.id);

  for (const conn of connectors) {
    const started = Date.now();
    let ok = true, error = null, results = [];
    try {
      if (sourceHealth) {
        const run = await sourceHealth.runAndRecord(conn, target);
        results = run.results || [];
        ok = run.summary.ok;
        error = run.summary.error;
      } else {
        const out = await conn.search(target);
        results = Array.isArray(out) ? out : (out ? [out] : []);
      }
    } catch (e) {
      ok = false;
      error = String(e.message || e);
    }

    let accepted = 0, merged = 0;
    for (const r of results.slice(0, resultLimitPerSource)) {
      try {
        const t = makeRealEstateFacetedThinga({
          ...r,
          source_id: r.source_id || r.source || conn.id,
          source_type: r.source_type || conn.type || r.type,
          connector_id: conn.id,
          legal_status: r.legal_status || "unknown",
        }, { includeRaw: true, parents: [planParentId] });
        rawThingas.push(t);
        const m = mergeIntoGraph(graph, t);
        if (m.merged) merged++;
        accepted++;
      } catch {
        // Bad source rows are ignored here; source_health keeps source-level failures.
      }
    }

    sourceRuns.push({
      source_id: conn.id,
      source_type: conn.type || "unknown",
      ok,
      error,
      found: results.length,
      accepted,
      merged,
      latency_ms: Date.now() - started,
    });
  }

  const analyzed = graph.map((t) => {
    const analysis = scoreConvergedThinga(t, buyers, buyerCandidates);
    const enriched = {
      ...t,
      facets: {
        ...t.facets,
        buyerDemand: {
          matches: analysis.buyer_matches,
          gaps: analysis.buyer_gaps,
          discovery_paths: BUYER_DISCOVERY_PATHS,
          next_step: analysis.spend_allowed ? "send_to_council_for_skiptrace_budget" : "hold_or_free_enrich",
        },
        workflow: {
          ...(t.facets?.workflow || {}),
          stage: analysis.tier,
          priority: analysis.score >= 75 ? "urgent" : analysis.score >= 55 ? "high" : "normal",
          next_step: analysis.spend_allowed ? "council_review_before_phone_spend" : "free_enrichment_or_hold",
        },
      },
      analysis,
    };
    if (thingaStore && analysis.score >= 55) {
      try { thingaStore.put(facetedToStoreThinga(enriched, { planParentId })); } catch { /* non-fatal mirror */ }
    }
    return enriched;
  }).sort((a, b) => b.analysis.score - a.analysis.score);

  return {
    target,
    search_plan: {
      ...selected.plan,
      selected_connector_ids: connectors.map((c) => c.id),
    },
    sources: sourceRuns,
    raw_records: sourceRuns.reduce((s, r) => s + r.found, 0),
    raw_thingas: rawThingas.length,
    converged_properties: graph.length,
    shortlist: analyzed.slice(0, shortlistLimit).map((t) => ({
      id: t.$header?.id || t.id,
      name: t.$header?.name,
      address: t.facets?.property?.address,
      property: t.facets?.property || {},
      listing: t.facets?.listing || {},
      owner: t.facets?.owner || {},
      contact: t.facets?.contact || {},
      score: t.analysis.score,
      tier: t.analysis.tier,
      spend_allowed: t.analysis.spend_allowed,
      spend_blocks: t.analysis.spend_blocks,
      projected_spread: t.analysis.spread.projectedSpread,
      anchor_spread: t.analysis.spread.anchorSpread,
      spread_status: t.analysis.spread.status,
      spread_needed: t.analysis.spread.nextNeeded,
      negotiation: t.analysis.spread.negotiation,
      best_negotiation_path: t.analysis.spread.bestNegotiationPath,
      spread: t.analysis.spread,
      reasons: t.analysis.reasons,
      confidence: t.analysis.confidence,
      identity_keys: t.analysis.identity_keys,
      buyer_matches: t.analysis.buyer_matches.slice(0, 5),
    })),
  };
}
