import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOnMarketActivationPackets,
  renderOnMarketActivationPacketsMarkdown,
} from "./onmarket_activation_packet.js";

test("credential-blocked RESO source becomes an OAuth/DUA request packet", () => {
  const report = buildOnMarketActivationPackets({
    built_at: "2026-06-29T00:00:00.000Z",
    activation_queue: [{
      file: "data/source-registry/pilot-manifest-onmarket-reso-2026-06-27.md",
      title: "RESO Web API via MLS",
      activation_stage: "blocked_credentials",
      lawful_path: "licensed RESO/MLS agreement",
      required_fields: ["listing_id", "situs", "list_price"],
      freshness_anchors: ["ModificationTimestamp delta sync"],
      blockers: ["Obtain OAuth2 client credentials."],
    }],
  });

  assert.equal(report.summary.credential_requests, 1);
  assert.equal(report.packets[0].request_type, "credential_scope");
  assert.equal(report.packets[0].recipient, "MLS data-access / broker compliance contact");
  assert.equal(report.packets[0].registry_row_template.credential_or_bulk_path, "mls_dua_oauth2");
  assert.match(report.packets[0].request_body, /OAuth2/);
});

test("public-record blocked federal source becomes a bulk request packet", () => {
  const report = buildOnMarketActivationPackets({
    activation_queue: [{
      file: "data/source-registry/pilot-manifest-onmarket-hud-homestore-2026-06-27.md",
      title: "HUD HomeStore",
      activation_stage: "blocked_public_records",
      lawful_path: "official government/public-record feed",
      required_fields: ["case_number", "situs", "list_price"],
      freshness_anchors: ["nightly refresh"],
    }],
  });

  assert.equal(report.summary.public_record_requests, 1);
  assert.equal(report.packets[0].request_type, "public_record_bulk");
  assert.equal(report.packets[0].registry_row_template.cadence, "nightly");
  assert.match(report.packets[0].subject, /HUD/);
  assert.match(report.packets[0].request_body, /bulk public-record extract/);
});

test("verification-blocked source asks for official URL and cadence", () => {
  const report = buildOnMarketActivationPackets({
    activation_queue: [{
      file: "data/source-registry/pilot-manifest-onmarket-fdic-reo-2026-06-28.md",
      title: "FDIC REO",
      activation_stage: "blocked_verification",
      blockers: ["Confirm live FDIC listing-search subpath."],
    }],
  });

  assert.equal(report.summary.verification_requests, 1);
  assert.equal(report.packets[0].request_type, "source_verification");
  assert.match(report.packets[0].request_body, /official listing\/search URL/);
});

test("activation packets markdown carries citations and registry row templates", () => {
  const report = buildOnMarketActivationPackets({
    activation_queue: [{
      file: "source.md",
      title: "Official Feed",
      activation_stage: "ready_to_pull",
    }],
  });
  const md = renderOnMarketActivationPacketsMarkdown(report);
  assert.match(md, /On-Market Activation Packets/);
  assert.match(md, /Citation: source\.md/);
  assert.match(md, /Next registry row:/);
  assert.match(md, /bounded_pull_checklist/);
});
