// route_engine.js — the modular route-extraction kernel.
//
// The product is NOT a phone finder. It is: "given a known entity + a goal, find the shortest legal
// evidence-backed path to an actionable result." Real-estate owner-contact is ONE route config;
// B2B/recruiting/contractor are others. The kernel knows only generic concepts:
//
//   capability  — an operation with inputs/outputs/cost/policy + a run() fn (wraps a connector, an
//                 API, a resolver, a compliance check, anything).
//   route       — a configurable recipe: an ordered list of {capability, input, output} steps.
//   policy      — weights + hard rules that gate actions (e.g. no outreach until DNC checked).
//   evidence    — every step's provenance, recorded as the route executes.
//
// Domain knowledge lives in PACKS (capabilities + routes registered from outside). Swap the pack,
// get a different product, same kernel.

// Resolve a step input reference ("target.address", "owner", literal) against the run vars.
function resolveRef(ref, vars) {
  if (ref == null) return undefined;
  if (typeof ref !== "string") return ref;
  if (ref.startsWith("=")) return ref.slice(1); // literal escape: "=foo" -> "foo"
  const parts = ref.split(".");
  let cur = vars;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

export function createRouteEngine() {
  const capabilities = new Map(); // id -> capability
  const routes = new Map();       // id -> route

  const registerCapability = (cap) => {
    if (!cap || !cap.id || typeof cap.run !== "function") throw new Error("capability needs { id, run() }");
    capabilities.set(cap.id, { cost: { money: 0, latency_ms: 0 }, policy: {}, ...cap });
    return engine;
  };
  const registerRoute = (route) => {
    if (!route || !route.id || !Array.isArray(route.steps)) throw new Error("route needs { id, steps[] }");
    routes.set(route.id, route);
    return engine;
  };

  // Execute one route over a target. Threads each step's output into vars for later steps.
  async function runRoute(routeId, target = {}, opts = {}) {
    const route = routes.get(routeId);
    if (!route) throw new Error(`no route "${routeId}"`);
    const vars = { target };
    const evidence = [];
    const steps = [];
    let totalCost = 0;

    for (const step of route.steps) {
      const cap = capabilities.get(step.capability);
      if (!cap) {
        steps.push({ capability: step.capability, status: "missing_capability" });
        if (step.required) break;
        continue;
      }
      const input = resolveRef(step.input, vars);
      const started = Date.now();
      let status = "ok", error = null, output;
      try {
        output = await cap.run({ vars, target, opts }, input);
      } catch (e) { status = "error"; error = String(e.message || e); }
      const latency_ms = Date.now() - started;
      totalCost += (cap.cost && cap.cost.money) || 0;
      if (status === "ok" && step.output) vars[step.output] = output;
      evidence.push({
        capability: cap.id, input_ref: step.input, output_ref: step.output || null,
        status, error, latency_ms, cost: cap.cost || null,
        legal_status: (cap.policy && cap.policy.legal_status) || "unspecified",
      });
      steps.push({ capability: cap.id, status, output_ref: step.output || null });
      if (status === "error" && step.required) break;
    }

    const result = route.output ? vars[route.output] : vars;
    return { route: routeId, goal: route.goal || null, domain: route.domain || null,
      target, result, vars, steps, evidence, total_cost: totalCost };
  }

  // Weighted, policy-aware planner: rank routes that serve a goal. Lower score = preferred.
  // weights tune the domain (cost/latency/legal_risk vs confidence/value).
  function plan(goal, { weights = {} } = {}) {
    const w = { cost: 1, latency: 0.001, legal_risk: 5, confidence: -3, value: -2, ...weights };
    const candidates = [...routes.values()].filter((r) => !goal || r.goal === goal);
    return candidates.map((r) => {
      const caps = r.steps.map((s) => capabilities.get(s.capability)).filter(Boolean);
      const cost = caps.reduce((s, c) => s + ((c.cost && c.cost.money) || 0), 0);
      const latency = caps.reduce((s, c) => s + ((c.cost && c.cost.latency_ms) || 0), 0);
      const legal_risk = Math.max(0, ...caps.map((c) => (c.policy && c.policy.risk) || 0), 0);
      const confidence = r.confidence ?? 0.5;
      const value = r.value ?? 0.5;
      const score = w.cost * cost + w.latency * latency + w.legal_risk * legal_risk
        + w.confidence * confidence + w.value * value;
      const missing = r.steps.filter((s) => !capabilities.has(s.capability)).map((s) => s.capability);
      return { route: r.id, goal: r.goal, score, cost, legal_risk, runnable: missing.length === 0, missing };
    }).sort((a, b) => a.score - b.score);
  }

  const engine = { registerCapability, registerRoute, runRoute, plan, capabilities, routes };
  return engine;
}
