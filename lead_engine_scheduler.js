// lead_engine_scheduler.js -- pure policy for autonomous lead-engine cadence.
//
// The server owns persistence and execution. This module owns the deterministic
// decisions: clamp settings, sanitize user input, and decide whether the next
// background tick should run, wait, or merely start the clock.

const num = (v, d, min, max) => {
  const n = v === null || v === undefined || v === "" ? d : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, n));
};

const txt = (v) => String(v || "").trim();

export function normalizeLeadEngineSettings(raw = {}) {
  return {
    autoHours: num(raw.autoHours ?? raw.lead_engine_auto_hours, 0, 0, 168),
    city: txt(raw.city ?? raw.lead_engine_city),
    state: txt(raw.state ?? raw.lead_engine_state),
    zip: txt(raw.zip ?? raw.lead_engine_zip),
    planId: txt(raw.planId ?? raw.lead_engine_plan_id ?? "all-enabled") || "all-enabled",
    sourceLimit: num(raw.sourceLimit ?? raw.lead_engine_source_limit, 0, 0, 100),
    resultLimitPerSource: num(raw.resultLimitPerSource ?? raw.lead_engine_result_limit, 100, 1, 500),
    shortlistLimit: num(raw.shortlistLimit ?? raw.lead_engine_shortlist_limit, 25, 1, 100),
    dispatchCouncil: raw.dispatchCouncil === true || raw.dispatchCouncil === "1" || raw.lead_engine_dispatch_council === "1",
    lastRun: raw.lastRun ?? raw.last_lead_engine_run ?? null,
    lastRunId: raw.lastRunId ?? raw.last_lead_engine_run_id ?? null,
    lastError: raw.lastError ?? raw.last_lead_engine_error ?? null,
  };
}

export function leadEngineSettingsWrites(body = {}) {
  const out = {};
  if (body.city !== undefined) out.lead_engine_city = txt(body.city);
  if (body.state !== undefined) out.lead_engine_state = txt(body.state);
  if (body.zip !== undefined) out.lead_engine_zip = txt(body.zip);
  if (body.planId !== undefined) out.lead_engine_plan_id = txt(body.planId) || "all-enabled";
  if (body.autoHours !== undefined && body.autoHours !== "") {
    out.lead_engine_auto_hours = String(num(body.autoHours, 0, 0, 168));
  }
  if (body.sourceLimit !== undefined && body.sourceLimit !== "") {
    out.lead_engine_source_limit = String(num(body.sourceLimit, 0, 0, 100));
  }
  if (body.resultLimitPerSource !== undefined && body.resultLimitPerSource !== "") {
    out.lead_engine_result_limit = String(num(body.resultLimitPerSource, 100, 1, 500));
  }
  if (body.shortlistLimit !== undefined && body.shortlistLimit !== "") {
    out.lead_engine_shortlist_limit = String(num(body.shortlistLimit, 25, 1, 100));
  }
  if (body.dispatchCouncil !== undefined) out.lead_engine_dispatch_council = body.dispatchCouncil ? "1" : "0";
  return out;
}

export function leadEngineTickDecision(settings, nowMs = Date.now()) {
  const cfg = normalizeLeadEngineSettings(settings);
  if (!cfg.autoHours || cfg.autoHours <= 0) return { action: "disabled", reason: "auto-run off" };
  if (!cfg.city && !cfg.zip) return { action: "disabled", reason: "no target" };
  if (!cfg.lastRun) return { action: "prime_clock", reason: "first scheduler tick starts the clock" };
  const lastMs = new Date(cfg.lastRun).getTime();
  if (!Number.isFinite(lastMs)) return { action: "run", reason: "invalid last run timestamp" };
  const elapsedMs = nowMs - lastMs;
  if (elapsedMs >= cfg.autoHours * 3600e3) return { action: "run", reason: "interval elapsed" };
  return {
    action: "wait",
    reason: "interval not elapsed",
    nextRunAt: new Date(lastMs + cfg.autoHours * 3600e3).toISOString(),
  };
}
