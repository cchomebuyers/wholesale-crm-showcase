import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOnMarketActivationPlan, renderOnMarketActivationMarkdown } from "./onmarket_activation_plan.js";

test("RESO source with credential blocker is not pull-ready", () => {
  const plan = buildOnMarketActivationPlan({
    built_at: "2026-06-29T00:00:00.000Z",
    sources: [{
      file: "data/source-registry/pilot-manifest-onmarket-reso.md",
      title: "RESO Web API via MLS",
      status: "verified",
      readiness_score: 85,
      lawful_basis: "MLS DUA and OAuth2 client credentials required.",
      blockers: ["Confirm MLS membership / sponsor-broker DUA scope; obtain OAuth2 client credentials."],
      next_steps: ["Confirm MLS membership / sponsor-broker DUA scope for the pilot market; obtain OAuth2 client credentials."],
    }],
  });

  assert.equal(plan.summary.total, 1);
  assert.equal(plan.summary.ready_to_pull, 0);
  assert.equal(plan.summary.credentials_blocked, 1);
  assert.equal(plan.activation_queue[0].activation_stage, "blocked_credentials");
  assert.equal(plan.activation_queue[0].pull_allowed_now, false);
  assert.equal(plan.activation_queue[0].lawful_path, "licensed RESO/MLS agreement");
});

test("federal REO source with FOIA blocker is public-records blocked", () => {
  const plan = buildOnMarketActivationPlan({
    sources: [{
      file: "data/source-registry/pilot-manifest-onmarket-hud.md",
      title: "HUD HomeStore",
      status: "draft",
      readiness_score: 50,
      lawful_basis: "Federal agency disposing of real property; no MLS-portal scraping.",
      blockers: ["File HUD FOIA request for bulk REO inventory and confirm receipt cadence."],
      next_steps: ["File HUD FOIA request for bulk REO inventory."],
    }],
  });

  assert.equal(plan.summary.public_records_blocked, 1);
  assert.equal(plan.activation_queue[0].activation_stage, "blocked_public_records");
  assert.equal(plan.activation_queue[0].lawful_path, "official government/public-record feed");
  assert.match(plan.activation_queue[0].next_action, /FOIA/);
});

test("verified source with no blockers is pull-ready", () => {
  const plan = buildOnMarketActivationPlan({
    sources: [{
      file: "source.md",
      title: "Official Feed",
      status: "verified",
      readiness_score: 90,
      lawful_basis: "Official API.",
      blockers: [],
    }],
  });

  assert.equal(plan.summary.ready_to_pull, 1);
  assert.equal(plan.activation_queue[0].activation_stage, "ready_to_pull");
  assert.equal(plan.activation_queue[0].pull_allowed_now, true);
});

test("activation markdown cites source files and blocker state", () => {
  const plan = buildOnMarketActivationPlan({
    sources: [{
      file: "source.md",
      title: "Official Feed",
      status: "draft",
      readiness_score: 40,
      blockers: ["Confirm freshness cadence."],
    }],
  });
  const md = renderOnMarketActivationMarkdown(plan);
  assert.match(md, /On-Market Activation Plan/);
  assert.match(md, /Citation: source\.md/);
  assert.match(md, /Pull allowed now: no/);
});
