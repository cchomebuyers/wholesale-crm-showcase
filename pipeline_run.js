// pipeline_run.js — the property "Fill" chain orchestrator.
//
// Runs the free, no-spend enrichment → tiering → export pipeline that turns the
// raw `properties` table into a tiered `pro_queue` (call_now / pay_to_unlock /
// research / hold) plus the pursuable-leads export. NO money is spent here: the
// only paid action in the system (per-property skip-trace) is a separate,
// human/AI-gated step (`POST /api/pro-queue/:propertyId/skiptrace`) and is NOT
// part of this chain. Every stage is an existing `tools/*.mjs` script; this
// module just sequences them, one at a time (so they never contend on crm.db),
// with `PIPELINE_RUN=1` set so the tools bypass their autonomous-loop `docs/HALT`
// guard for this user-initiated run, and `NO_BACKUP=1` so boot/test backups stay off.
//
// Stages are run via child processes deliberately: each tool already opens its
// own crm.db connection with a busy timeout, and running them sequentially in
// separate processes avoids the concurrent-writer contention the loop docs warn
// about (LOOP_PROMPT.md). The server stays the single long-lived reader.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Ordered manifest. Each stage:
//   id        stable key (used by presets + the UI)
//   label     human label for progress display
//   script    tools/*.mjs to run
//   args(f)   build CLI args from the filter object
//   optional  best-effort enrichment — a failure logs but does NOT abort the chain
//   network   hits the network (slower; skipped by the "local" preset)
//   timeoutMs hard kill ceiling
//
// Required stages (optional:false) are the local re-tier core: grade → build →
// export. They operate on the existing `properties` table and always run, so the
// chain still produces a fresh tiered queue even if every network stage is skipped
// or fails.
export const PIPELINE_STAGES = [
  { id: "harvest",   label: "Harvest official property sources", script: "tools/harvest_properties.mjs",
    args: (f) => [`--pages=${f.pages ?? 1}`, `--max-sources=${f.maxSources ?? 6}`, "--import", `--min-score=${f.minScore ?? 60}`],
    optional: true, network: true, timeoutMs: 20 * 60_000 },
  { id: "context",   label: "Fill county / source context", script: "tools/enrich_property_context.mjs",
    args: () => [], optional: true, network: true, timeoutMs: 10 * 60_000 },
  { id: "geocode",   label: "Geocode missing coordinates", script: "tools/geocode_property_gaps.mjs",
    args: () => [], optional: true, network: true, timeoutMs: 10 * 60_000 },
  { id: "geo_apply", label: "Apply geo enrichment to properties", script: "tools/apply_geo_enrichment_to_properties.mjs",
    args: () => [], optional: true, network: false, timeoutMs: 5 * 60_000 },
  { id: "owners",    label: "Owner-of-record join", script: "tools/enrich_owners_for_queue.mjs",
    args: () => [], optional: true, network: true, timeoutMs: 15 * 60_000 },
  { id: "portfolio", label: "Detect owner portfolios (bulk sellers)", script: "tools/detect_owner_portfolios.mjs",
    args: () => [], optional: true, network: false, timeoutMs: 5 * 60_000 },
  { id: "arv",       label: "ARV / MAO from comps", script: "tools/enrich_arv_cook.mjs",
    args: () => [], optional: true, network: false, timeoutMs: 15 * 60_000 },
  { id: "buyers",    label: "Discover cash buyers + market demand", script: "tools/discover_cook_buyers.mjs",
    args: () => [], optional: true, network: true, timeoutMs: 10 * 60_000 },
  { id: "grade",     label: "Per-property grade", script: "tools/apply_property_score.mjs",
    args: () => [], optional: false, network: false, timeoutMs: 10 * 60_000 },
  { id: "build",     label: "Build pro-queue + assign tiers", script: "tools/build_pro_queue.mjs",
    args: (f) => ["--persist", `--hot-score=${f.hotScore ?? 70}`, `--min-score=${f.minScore ?? 60}`],
    optional: false, network: false, timeoutMs: 10 * 60_000 },
  { id: "export",    label: "Export pursuable leads (spend-gated list)", script: "tools/export_pursuable_leads.mjs",
    args: () => [], optional: false, network: false, timeoutMs: 5 * 60_000 },
];

// Preset stage selections.
//   local — re-tier from existing properties only (no network, fast, zero spend)
//   full  — the whole chain incl. network enrichment (still zero spend)
export const PIPELINE_PRESETS = {
  local: ["grade", "build", "export"],
  full: PIPELINE_STAGES.map((s) => s.id),
};

export function resolveStageIds({ preset, stageIds } = {}) {
  if (Array.isArray(stageIds) && stageIds.length) {
    return PIPELINE_STAGES.map((s) => s.id).filter((id) => stageIds.includes(id));
  }
  return PIPELINE_PRESETS[preset] || PIPELINE_PRESETS.full;
}

function tailLines(s, n = 8) {
  return String(s || "").split(/\r?\n/).filter(Boolean).slice(-n).join("\n");
}

// Run the chain sequentially. `hooks`:
//   onStageStart({ id, label, index, total })
//   onStageEnd({ id, label, status, code, ms, tail, error })
// Returns { ok, abortedAt, stages: [{ id, label, status, code, ms, optional, tail, error }] }.
// `status` ∈ "ok" | "error" | "skipped". A required-stage error aborts the rest
// (they are recorded as "skipped"); an optional-stage error is recorded and the
// chain continues.
export async function runPipeline(opts = {}, hooks = {}) {
  const { filters = {}, repoRoot = process.cwd() } = opts;
  const stageIds = resolveStageIds(opts);
  const stages = PIPELINE_STAGES.filter((s) => stageIds.includes(s.id));
  const results = [];
  let aborted = false;
  let abortedAt = null;

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (aborted) {
      const skipped = { id: s.id, label: s.label, status: "skipped", code: null, ms: 0, optional: s.optional };
      results.push(skipped);
      hooks.onStageEnd?.(skipped);
      continue;
    }
    hooks.onStageStart?.({ id: s.id, label: s.label, index: i, total: stages.length });
    const started = Date.now();
    try {
      const { stdout } = await execFileP(process.execPath, [s.script, ...s.args(filters)], {
        cwd: repoRoot,
        env: { ...process.env, PIPELINE_RUN: "1", NO_BACKUP: "1" },
        maxBuffer: 32 * 1024 * 1024,
        timeout: s.timeoutMs || 10 * 60_000,
        windowsHide: true,
      });
      const r = { id: s.id, label: s.label, status: "ok", code: 0, ms: Date.now() - started, optional: s.optional, tail: tailLines(stdout) };
      results.push(r);
      hooks.onStageEnd?.(r);
    } catch (e) {
      const r = { id: s.id, label: s.label, status: "error", code: e.code ?? 1, ms: Date.now() - started,
        optional: s.optional, error: String(e.message || e), tail: tailLines(e.stdout || "") };
      results.push(r);
      hooks.onStageEnd?.(r);
      if (!s.optional) { aborted = true; abortedAt = s.id; }
    }
  }

  const ok = results.every((r) => r.status === "ok" || (r.status === "error" && r.optional));
  return { ok, abortedAt, stages: results };
}
