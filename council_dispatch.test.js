import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCouncilJob,
  defaultCouncilReviewers,
  listCouncilJobs,
  loadCouncilParticipants,
  readCouncilJob,
  syncCouncilJobResponses,
  updateCouncilJob,
} from "./council_dispatch.js";

const here = dirname(fileURLToPath(import.meta.url));
const room = join(here, "councilRoom");

const cleanup = (id) => {
  const p = join(room, "jobs", `${id}.json`);
  if (existsSync(p)) unlinkSync(p);
  for (const participant of ["CODEX", "HUMAN_REVIEWER", "REVIEWER_ALPHA", "HUMAN_OPS"]) {
    const msg = join(room, "agents", participant, "inbox", `TEST_${id}.msg`);
    if (existsSync(msg)) unlinkSync(msg);
  }
};

test("council jobs persist queued and dispatched lifecycle state", () => {
  const job = createCouncilJob({
    packetFile: join(room, "broadcast", "lead-council-packets", "test-packet.json"),
    target: { city: "Detroit", state: "MI" },
    count: 3,
    agents: ["REVIEWER_ALPHA", "HUMAN_OPS"],
  });
  try {
    assert.match(job.id, /^council-job-/);
    assert.equal(job.status, "queued");
    assert.equal(job.count, 3);
    assert.deepEqual(job.agents, ["REVIEWER_ALPHA", "HUMAN_OPS"]);
    assert.equal(readCouncilJob(job.id).target.city, "Detroit");

    const sent = updateCouncilJob(job.id, { status: "dispatched", delivered: ["REVIEWER_ALPHA"] });
    assert.equal(sent.status, "dispatched");
    assert.deepEqual(readCouncilJob(job.id).delivered, ["REVIEWER_ALPHA"]);
    assert.ok(listCouncilJobs({ limit: 20 }).some((x) => x.id === job.id));
  } finally {
    cleanup(job.id);
  }
});

test("participant registry is data-driven and can return any number of reviewers", () => {
  const participants = loadCouncilParticipants({ includeDisabled: true });
  assert.ok(Array.isArray(participants));
  assert.ok(participants.every((p) => p.id));
  const reviewers = defaultCouncilReviewers({ exclude: ["CRM"] });
  assert.ok(Array.isArray(reviewers));
});

test("readCouncilJob returns null for missing jobs", () => {
  assert.equal(readCouncilJob("council-job-missing"), null);
});

test("syncCouncilJobResponses marks a job responded when a council message references it", () => {
  const job = createCouncilJob({
    packetFile: join(room, "broadcast", "lead-council-packets", "test-response-packet.json"),
    target: { city: "Cleveland", state: "OH" },
    count: 1,
    agents: ["HUMAN_REVIEWER"],
  });
  const inbox = join(room, "agents", "HUMAN_REVIEWER", "inbox");
  const msg = join(inbox, `TEST_${job.id}.msg`);
  try {
    mkdirSync(inbox, { recursive: true });
    writeFileSync(msg, [
      "FROM: HUMAN_REVIEWER",
      "TO: CRM",
      "SUBJECT: lead council decision",
      "",
      `Council job id: ${job.id}`,
      "Approve candidate thinga:abc for paid skiptrace after owner tax-roll lookup.",
    ].join("\n"));

    const synced = syncCouncilJobResponses(job.id);
    assert.equal(synced.status, "responded");
    assert.equal(synced.responses.length, 1);
    assert.equal(synced.responses[0].agent, "HUMAN_REVIEWER");
    assert.match(synced.responses[0].summary, /Council job id/);
  } finally {
    cleanup(job.id);
  }
});
