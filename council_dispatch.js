// council_dispatch.js -- bridge CRM decisions into the local councilRoom protocol.
//
// The council is file/stdin based. This module writes a review packet, then uses
// the existing send.mjs tool so any configured council participant can receive
// the task exactly like other council messages. Participants are registry/file
// driven: agents, humans, and data workers can be added without code changes.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = here;
const council = join(repo, "councilRoom");
const packetsDir = join(council, "broadcast", "lead-council-packets");
const jobsDir = join(council, "jobs");
const jobsLog = join(jobsDir, "jobs.jsonl");
const sendTool = join(council, "tools", "send.mjs");
const agentsFile = join(council, "agents.json");
const agentsDir = join(council, "agents");

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function safe(s) {
  return String(s || "packet").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

export function loadCouncilParticipants({ includeDisabled = false } = {}) {
  const fromConfig = [];
  try {
    const cfg = JSON.parse(readFileSync(agentsFile, "utf8"));
    for (const [id, spec] of Object.entries(cfg.agents || {})) {
      if (!includeDisabled && spec && spec.enabled === false) continue;
      fromConfig.push({
        id,
        kind: spec.kind || spec.type || "agent",
        enabled: spec.enabled !== false,
        prompt: spec.prompt || null,
      });
    }
  } catch {
    // Missing config is fine; filesystem participants below still work.
  }
  const known = new Set(fromConfig.map((p) => p.id));
  const fromDirs = existsSync(agentsDir) ? readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !known.has(d.name))
    .map((d) => ({ id: d.name, kind: "participant", enabled: true, prompt: null })) : [];
  return [...fromConfig, ...fromDirs];
}

export function defaultCouncilReviewers({ exclude = [] } = {}) {
  const blocked = new Set(exclude.map((x) => String(x).toUpperCase()));
  return loadCouncilParticipants()
    .filter((p) => p.enabled !== false)
    .filter((p) => !blocked.has(String(p.id).toUpperCase()))
    .map((p) => p.id);
}

function jobPath(id) {
  return join(jobsDir, `${safe(id)}.json`);
}

function writeJob(job) {
  mkdirSync(jobsDir, { recursive: true });
  const next = { ...job, updated_at: new Date().toISOString() };
  writeFileSync(jobPath(next.id), JSON.stringify(next, null, 2));
  appendFileSync(jobsLog, JSON.stringify({
    at: next.updated_at,
    id: next.id,
    status: next.status,
    agents: next.agents,
    packet: next.packet,
    error: next.error || null,
  }) + "\n");
  return next;
}

export function createCouncilJob({ packetFile, target = {}, count = 0, agents = null, kind = "lead_council_review", requester = "CRM" } = {}) {
  const reviewers = uniq(agents && agents.length ? agents : defaultCouncilReviewers({ exclude: [requester] }));
  const id = `council-job-${stamp()}-${randomUUID().slice(0, 8)}`;
  return writeJob({
    id,
    kind,
    status: "queued",
    created_at: new Date().toISOString(),
    requester,
    target,
    count,
    agents: reviewers,
    packet: packetFile ? relative(repo, resolve(packetFile)) : null,
    delivered: [],
    responses: [],
    error: null,
  });
}

export function updateCouncilJob(id, patch = {}) {
  const existing = readCouncilJob(id);
  if (!existing) throw new Error(`council job not found: ${id}`);
  return writeJob({ ...existing, ...patch });
}

export function readCouncilJob(id) {
  const p = jobPath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function listCouncilJobs({ limit = 50 } = {}) {
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(jobsDir, f), "utf8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function readTextIfExists(path) {
  try { return existsSync(path) ? readFileSync(path, "utf8") : null; } catch { return null; }
}

function participantInboxMessages(agent) {
  const dir = join(council, "agents", agent, "inbox");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".msg") || f.endsWith(".md") || f.endsWith(".txt"))
    .map((f) => {
      const path = join(dir, f);
      const text = readTextIfExists(path);
      return text ? { agent, file: relative(repo, path), text } : null;
    })
    .filter(Boolean);
}

function copyContextDocs() {
  const targetDir = join(council, "contextDocs", "autonomous-lead-engine");
  mkdirSync(targetDir, { recursive: true });
  const files = [
    "autonomous_lead_engine.js",
    "real_estate_facets.js",
    "real_estate_thinga.js",
    "buyer_matching.js",
    "property_imagery.js",
    "industrial_lead_simulator.js",
    "docs/industrial_lead_failure_simulation.md",
    "docs/real_estate_thinga_operating_model.md",
  ];
  const copied = [];
  for (const f of files) {
    const src = join(repo, f);
    if (!existsSync(src)) continue;
    const dest = join(targetDir, f.replace(/[\\/]/g, "__"));
    copyFileSync(src, dest);
    copied.push(relative(repo, dest));
  }
  return copied;
}

export function writeCouncilReviewPacket({ cycle, target = {}, agents = null, requester = "CRM" } = {}) {
  mkdirSync(packetsDir, { recursive: true });
  const copied = copyContextDocs();
  const reviewers = uniq(agents && agents.length ? agents : defaultCouncilReviewers({ exclude: [requester] }));
  const file = join(packetsDir, `${stamp()}_${safe(target.city || target.zip || "market")}_lead_council_packet.json`);
  const packet = {
    created_at: new Date().toISOString(),
    target,
    purpose: "Council review of converged property Thingas before paid phone-number spend.",
    decision_rule: "Only recommend BatchData/paid skiptrace when evidence says the property is real, not sold-only, and likely has buyer demand or strong distress.",
    requester,
    agents: reviewers,
    copied_context: copied,
    cycle,
  };
  writeFileSync(file, JSON.stringify(packet, null, 2));
  return { file, packet, copied };
}

export function dispatchCouncilReview({ packetFile, target = {}, count = 0, agents = null, jobId = null, requester = "CRM" } = {}) {
  const rel = relative(repo, resolve(packetFile));
  const reviewers = uniq(agents && agents.length ? agents : defaultCouncilReviewers({ exclude: [requester] }));
  const body = [
    "Autonomous lead engine produced a filtered shortlist for council review.",
    "",
    jobId ? `Council job id: ${jobId}` : null,
    `Target: ${JSON.stringify(target)}`,
    `Shortlist count: ${count}`,
    `Packet: ${rel}`,
    "",
    "Task:",
    "1. Read the packet and copied context docs.",
    "2. Challenge weak identity/contact claims.",
    "3. Mark which properties deserve paid phone-number spend.",
    "4. Prefer free enrichment first: owner fieldmaps, parcel/tax roll, buyer demand, imagery evidence.",
    `5. Send ${requester} a concise decision report with ${jobId ? `Council job id ${jobId}, ` : ""}property ids, reasons, and blockers.`,
  ].filter(Boolean).join("\n");

  const delivered = [];
  for (const agent of reviewers) {
    execFileSync(process.execPath, [sendTool, requester, agent, "lead council review shortlist", body], { cwd: repo });
    delivered.push(agent);
  }
  return { delivered, packet: rel };
}

export function syncCouncilJobResponses(id) {
  const job = readCouncilJob(id);
  if (!job) throw new Error(`council job not found: ${id}`);
  const markers = [job.id, job.packet, job.packet ? basename(job.packet) : null].filter(Boolean);
  const seen = new Set((job.responses || []).map((r) => r.file));
  const responses = [...(job.responses || [])];
  const participants = uniq([
    job.requester,
    ...(job.agents || []),
    ...loadCouncilParticipants({ includeDisabled: true }).map((p) => p.id),
  ]);
  for (const agent of participants) {
    for (const msg of participantInboxMessages(agent)) {
      if (seen.has(msg.file)) continue;
      if (!markers.some((m) => msg.text.includes(m))) continue;
      responses.push({
        agent: msg.agent,
        file: msg.file,
        matched_at: new Date().toISOString(),
        summary: msg.text.split(/\r?\n/).filter(Boolean).slice(0, 8).join(" ").slice(0, 500),
      });
      seen.add(msg.file);
    }
  }
  const status = responses.length ? "responded" : job.status;
  return updateCouncilJob(id, { responses, status });
}

export function retryCouncilJob(id) {
  const job = readCouncilJob(id);
  if (!job) throw new Error(`council job not found: ${id}`);
  if (!job.packet) throw new Error(`council job has no packet: ${id}`);
  const packetFile = join(repo, job.packet);
  const sent = dispatchCouncilReview({
    packetFile,
    target: job.target,
    count: job.count,
    agents: job.agents,
    jobId: job.id,
    requester: job.requester || "CRM",
  });
  return updateCouncilJob(id, {
    status: "dispatched",
    delivered: sent.delivered,
    packet: sent.packet,
    error: null,
    retry_count: Number(job.retry_count || 0) + 1,
  });
}

export function writeAndDispatchCouncilReview(args = {}) {
  const written = writeCouncilReviewPacket(args);
  let job = createCouncilJob({
    packetFile: written.file,
    target: args.target,
    count: args.cycle?.shortlist?.length || 0,
    agents: args.agents,
    requester: args.requester || "CRM",
  });
  try {
    const sent = dispatchCouncilReview({
      packetFile: written.file,
      target: args.target,
      count: args.cycle?.shortlist?.length || 0,
      agents: args.agents,
      jobId: job.id,
      requester: job.requester || "CRM",
    });
    job = updateCouncilJob(job.id, { status: "dispatched", delivered: sent.delivered, packet: sent.packet });
    return { ...written, ...sent, job_id: job.id, job_status: job.status, job };
  } catch (e) {
    job = updateCouncilJob(job.id, { status: "failed", error: String(e.message || e) });
    return { ...written, delivered: [], packet: relative(repo, resolve(written.file)), job_id: job.id, job_status: job.status, job, error: job.error };
  }
}
