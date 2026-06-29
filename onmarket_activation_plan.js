const str = (v) => (v === null || v === undefined ? "" : String(v));

export function buildOnMarketActivationPlan(readiness = {}) {
  const sources = Array.isArray(readiness.sources) ? readiness.sources : [];
  const activation_queue = sources.map(sourceActivationItem);
  const summary = {
    total: activation_queue.length,
    ready_to_pull: activation_queue.filter((s) => s.activation_stage === "ready_to_pull").length,
    credentials_blocked: activation_queue.filter((s) => s.activation_stage === "blocked_credentials").length,
    public_records_blocked: activation_queue.filter((s) => s.activation_stage === "blocked_public_records").length,
    verification_blocked: activation_queue.filter((s) => s.activation_stage === "blocked_verification").length,
  };

  return {
    built_at: new Date().toISOString(),
    readiness_built_at: readiness.built_at || null,
    summary,
    activation_queue,
    citations: activation_queue.map((s) => ({
      claim: `on-market activation gate for ${s.title}`,
      file: s.file,
    })),
  };
}

export function renderOnMarketActivationMarkdown(plan) {
  const lines = [
    "# On-Market Activation Plan",
    "",
    `Built: ${plan.built_at}`,
    plan.readiness_built_at ? `Readiness input: ${plan.readiness_built_at}` : null,
    "",
    `Sources: ${plan.summary.total} | ready to pull: ${plan.summary.ready_to_pull} | credentials blocked: ${plan.summary.credentials_blocked} | public-records blocked: ${plan.summary.public_records_blocked} | verification blocked: ${plan.summary.verification_blocked}`,
    "",
    "## Activation Queue",
    "",
  ].filter((line) => line !== null);

  for (const source of plan.activation_queue) {
    lines.push(`### ${source.title}`);
    lines.push(`- Stage: ${source.activation_stage}`);
    lines.push(`- Citation: ${source.file}`);
    lines.push(`- Lawful path: ${source.lawful_path}`);
    lines.push(`- Pull allowed now: ${source.pull_allowed_now ? "yes" : "no"}`);
    lines.push(`- Next action: ${source.next_action}`);
    if (source.blockers.length) lines.push(`- Blockers: ${source.blockers.join("; ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function sourceActivationItem(source = {}) {
  const blockers = Array.isArray(source.blockers) ? source.blockers.filter(Boolean) : [];
  const blockerText = blockers.join(" ").toLowerCase();
  const nextSteps = Array.isArray(source.next_steps) ? source.next_steps.filter(Boolean) : [];
  const stage = activationStage(source, blockerText);
  const pullAllowedNow = stage === "ready_to_pull";

  return {
    file: source.file || "",
    title: source.title || source.file || "unknown source",
    readiness_score: Number(source.readiness_score) || 0,
    source_status: source.status || "unknown",
    activation_stage: stage,
    pull_allowed_now: pullAllowedNow,
    lawful_path: classifyLawfulPath(source, blockerText),
    next_action: nextActivationAction({ source, stage, blockers, nextSteps }),
    blockers,
    required_fields: Array.isArray(source.required_fields) ? source.required_fields : [],
    freshness_anchors: Array.isArray(source.freshness_anchors) ? source.freshness_anchors : [],
  };
}

function activationStage(source, blockerText) {
  if (/oauth|credential|client credentials|api key|dua|membership|sponsor-broker/.test(blockerText)) {
    return "blocked_credentials";
  }
  if (/foia|public-record|public record|bulk path|bulk\/public-record/.test(blockerText)) {
    return "blocked_public_records";
  }
  if (/confirm|verify|pending|cadence|subpath|refresh/.test(blockerText)) {
    return "blocked_verification";
  }
  if (source.status === "verified" && Number(source.readiness_score) >= 70) return "ready_to_pull";
  return "blocked_verification";
}

function classifyLawfulPath(source, blockerText) {
  const basis = str(source.lawful_basis).toLowerCase();
  const title = str(source.title).toLowerCase();
  const combined = `${title} ${basis} ${blockerText}`;
  if (/foia|public-record|public record|federal agency|\.gov|hud|usda|gsa|fdic/.test(combined)) {
    return "official government/public-record feed";
  }
  if (/reso|mls|idx|vow|oauth|dua/.test(combined)) return "licensed RESO/MLS agreement";
  return "official/sanctioned source only";
}

function nextActivationAction({ source, stage, blockers, nextSteps }) {
  if (stage === "ready_to_pull") return "Run a bounded delta pull and validate field/freshness coverage.";
  if (stage === "blocked_credentials") {
    return firstMatching(nextSteps, /credential|oauth|dua|membership|base url|sponsor/i)
      || "Obtain and record permitted access scope before any live pull.";
  }
  if (stage === "blocked_public_records") {
    return firstMatching(nextSteps, /foia|public-record|bulk/i)
      || "File/confirm the official bulk public-record path before connector work.";
  }
  return blockers[0] || firstMatching(nextSteps, /confirm|verify|validate|cadence|subpath/i)
    || "Confirm official source fields, freshness, and reuse terms before pulling data.";
}

function firstMatching(items, re) {
  return (items || []).find((item) => re.test(str(item))) || "";
}
