// packs/property_contact_route_pack.js -- executable ContactRouteEngine route packs
// for real-estate acquisition Thingas.
//
// Property Thingas already carry facts, candidate field_edges, and proof citations.
// This pack turns that substrate payload into:
//   1. ContactRouteEngine args that can be executed again.
//   2. A route-pack Thinga that records the chosen legal path.
//   3. KG-style entities/edges/citations for later wholesale_kg persistence.

import { resolveContactRoute } from "../contact_route_engine.js";

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const slug = (v) => String(v || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "") || "unknown";

function substrateOf(thinga = {}) {
  return thinga.content?.substrate || {};
}

function factsOf(thinga = {}) {
  return substrateOf(thinga).facts || {};
}

export function propertyNodeForContactRoute(thinga = {}) {
  const facts = factsOf(thinga);
  const identity = facts.identity || {};
  const owner = facts.owner || {};
  const joinable = facts.joinable_fields || {};
  const address = clean(identity.address) || clean(thinga.content?.address);

  return {
    id: thinga.id || (thinga.content?.crm_id ? `thinga:property-${thinga.content.crm_id}` : null),
    kind: "property",
    fields: {
      address,
      parcel_id: clean(identity.parcel_id) || clean(joinable.parcel_id),
      owner_name: clean(owner.owner_name) || clean(joinable.owner_name),
      mailing_address: clean(owner.owner_mailing) || clean(joinable.mailing_address),
      phone: clean(joinable.phone),
      email: clean(joinable.email),
    },
    content: {
      crm_id: thinga.content?.crm_id ?? null,
      city: clean(identity.city) || clean(thinga.content?.city),
      state: clean(identity.state) || clean(thinga.content?.state),
      zip: clean(identity.zip) || clean(thinga.content?.zip),
      county: clean(identity.county),
      source: clean(identity.source) || clean(thinga.content?.source),
      source_id: clean(identity.source_id) || clean(thinga.content?.source_id),
    },
  };
}

export function kgProjectionForPropertyRoutePack(thinga = {}, routePack = {}) {
  const substrate = substrateOf(thinga);
  const fieldEdges = Array.isArray(substrate.field_edges) ? substrate.field_edges : [];
  const citations = Array.isArray(substrate.proof_stack?.citations) ? substrate.proof_stack.citations : [];
  const propertyId = thinga.id || routePack.property_thinga_id;
  const packId = routePack.id || `routepack:${slug(propertyId)}`;

  const entities = [
    {
      id: propertyId,
      kind: "property",
      type: "real_estate_acquisition",
      name: thinga.name || routePack.target?.fields?.address || propertyId,
      content: {
        crm_id: thinga.content?.crm_id ?? null,
        address: routePack.target?.fields?.address || null,
        route_pack_id: packId,
      },
    },
    {
      id: packId,
      kind: "route_pack",
      type: "contact_route_engine",
      name: `Contact route for ${thinga.name || propertyId}`,
      content: {
        property_thinga_id: propertyId,
        best_path: routePack.contact_route_engine?.best_path?.route || null,
        outreach_allowed: false,
      },
    },
  ];

  const edgeEntities = [];
  const edges = [
    {
      from_id: propertyId,
      edge_type: "has_contact_route_pack",
      to_id: packId,
      source_id: "packs/property_contact_route_pack.js",
      confidence: 1,
    },
  ];

  for (const edge of fieldEdges) {
    const targetId = `kg:${slug(edge.match_key || `${edge.to_kind}:${edge.via_field}:${edge.value}`)}`;
    edgeEntities.push({
      id: targetId,
      kind: edge.to_kind || "candidate",
      type: "candidate_identity",
      name: edge.value || edge.match_key || targetId,
      content: {
        match_key: edge.match_key || null,
        via_field: edge.via_field || null,
        status: edge.status || "candidate",
      },
    });
    edges.push({
      from_id: propertyId,
      edge_type: `candidate_${edge.via_field || "field"}_edge`,
      to_id: targetId,
      source_id: edge.evidence?.[0]?.source || thinga.content?.source || "field_edges.js",
      confidence: Number.isFinite(Number(edge.confidence)) ? Number(edge.confidence) : null,
    });
  }

  const seen = new Set(entities.map((e) => e.id));
  for (const entity of edgeEntities) {
    if (!seen.has(entity.id)) {
      entities.push(entity);
      seen.add(entity.id);
    }
  }

  return {
    entities,
    edges,
    citations: citations.map((c) => ({
      entity_id: propertyId,
      claim: c.claim || "property proof citation",
      source_path: c.module || c.source || "unknown",
      source_kind: "file",
      line_ref: null,
    })),
  };
}

export function buildPropertyContactRoutePack(thinga = {}, opts = {}) {
  const target = propertyNodeForContactRoute(thinga);
  const contactRoute = resolveContactRoute({
    node: { id: target.id, kind: target.kind, fields: target.fields },
    goal: opts.goal || "phone",
    hasKeys: opts.hasKeys || {},
    channels: opts.channels,
  });
  const propertySlug = slug(target.id || target.content?.crm_id || target.fields.address);
  const routePack = {
    id: `routepack:${propertySlug}:contact-route`,
    kind: "contact_route_pack",
    schema: "ankhor.v1.contactRoutePack",
    property_thinga_id: target.id,
    target,
    executable: {
      engine: "ContactRouteEngine",
      handler: "resolveContactRoute",
      args: {
        node: { id: target.id, kind: target.kind, fields: target.fields },
        goal: opts.goal || "phone",
        hasKeys: opts.hasKeys || {},
      },
    },
    contact_route_engine: contactRoute,
    evidence: {
      field_edges: substrateOf(thinga).field_edges || [],
      proof_citations: substrateOf(thinga).proof_stack?.citations || [],
    },
    outreach_allowed: false,
    blocked_reason: contactRoute.blocked_reason,
    built_at: opts.builtAt || new Date().toISOString(),
  };
  routePack.kg_projection = kgProjectionForPropertyRoutePack(thinga, routePack);
  return routePack;
}

export function routePackToThinga(routePack = {}) {
  return {
    id: `thinga:${routePack.id}`,
    kind: "route_pack",
    name: `Contact route pack ${routePack.property_thinga_id || ""}`.trim(),
    schema: null,
    parents: routePack.property_thinga_id ? [routePack.property_thinga_id] : [],
    links: routePack.property_thinga_id ? [{ kind: "route_pack_for", to: routePack.property_thinga_id }] : [],
    category_path: "RoutePacks/RealEstate/Contact",
    content: routePack,
    tags: ["realEstate", "ContactRouteEngine", "kg_projection"],
  };
}
