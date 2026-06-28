// ecosystem_search_plan.js -- open-ended search plans for the lead engine.
//
// A plan is data, not code: any number of sources, participants, humans, or data
// paths can be included. The engine may still use execution limits for cost/rate
// control, but source membership is selected by plan rules instead of a fixed
// list or hardcoded count.

const arr = (v) => Array.isArray(v) ? v.filter(Boolean) : [];
const set = (v) => new Set(arr(v).map((x) => String(x)));

export function normalizeSearchPlan(plan = {}) {
  return {
    id: plan.id || "default",
    name: plan.name || "Default search plan",
    includeConnectorIds: arr(plan.includeConnectorIds || plan.connectors || plan.connectorIds),
    excludeConnectorIds: arr(plan.excludeConnectorIds),
    includeSourceTypes: arr(plan.includeSourceTypes || plan.sourceTypes),
    excludeSourceTypes: arr(plan.excludeSourceTypes),
    includeGroups: arr(plan.includeGroups || plan.groups),
    maxConnectors: plan.maxConnectors == null || plan.maxConnectors === "" ? null : Math.max(0, Number(plan.maxConnectors) || 0),
    costPolicy: plan.costPolicy || "free_first",
    participants: arr(plan.participants),
    notes: arr(plan.notes),
  };
}

export function connectorDescriptor(conn = {}) {
  return {
    id: conn.id || conn.source_id || "unknown",
    type: conn.type || conn.source_type || "unknown",
    group: conn.group || conn.category || conn.type || "unknown",
    free: conn.free !== false,
    enabled: conn.enabled !== false,
  };
}

export function selectConnectorsForPlan(registry = {}, rawPlan = {}) {
  const plan = normalizeSearchPlan(rawPlan);
  const includeIds = set(plan.includeConnectorIds);
  const excludeIds = set(plan.excludeConnectorIds);
  const includeTypes = set(plan.includeSourceTypes);
  const excludeTypes = set(plan.excludeSourceTypes);
  const includeGroups = set(plan.includeGroups);

  let connectors = Object.values(registry).filter((conn) => conn && typeof conn.search === "function" && conn.enabled !== false);
  connectors = connectors.filter((conn) => {
    const d = connectorDescriptor(conn);
    if (excludeIds.has(d.id) || excludeTypes.has(d.type)) return false;
    if (includeIds.size && !includeIds.has(d.id)) return false;
    if (includeTypes.size && !includeTypes.has(d.type)) return false;
    if (includeGroups.size && !includeGroups.has(d.group)) return false;
    return true;
  });
  if (plan.maxConnectors != null) connectors = connectors.slice(0, plan.maxConnectors);
  return { plan, connectors };
}

export function buildEcosystemSnapshot({ registry = {}, participants = [], searchPlan = {} } = {}) {
  const { plan, connectors } = selectConnectorsForPlan(registry, searchPlan);
  return {
    generated_at: new Date().toISOString(),
    plan,
    counts: {
      connectors_total: Object.keys(registry).length,
      connectors_selected: connectors.length,
      participants: participants.length,
    },
    connectors: connectors.map(connectorDescriptor),
    participants: participants.map((p) => ({
      id: p.id,
      kind: p.kind || "participant",
      enabled: p.enabled !== false,
      prompt: p.prompt || null,
    })),
  };
}

