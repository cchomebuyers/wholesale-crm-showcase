const str = (v) => (v === null || v === undefined ? "" : String(v));

export function buildOnMarketActivationPackets(plan = {}) {
  const queue = Array.isArray(plan.activation_queue) ? plan.activation_queue : [];
  const packets = queue.map(packetForSource);
  const summary = {
    total: packets.length,
    credential_requests: packets.filter((p) => p.request_type === "credential_scope").length,
    public_record_requests: packets.filter((p) => p.request_type === "public_record_bulk").length,
    verification_requests: packets.filter((p) => p.request_type === "source_verification").length,
    pull_checklists: packets.filter((p) => p.request_type === "bounded_pull_checklist").length,
  };

  return {
    built_at: new Date().toISOString(),
    activation_plan_built_at: plan.built_at || null,
    summary,
    packets,
    citations: packets.map((p) => ({
      claim: `activation packet for ${p.title}`,
      file: p.citation_file,
    })),
  };
}

export function renderOnMarketActivationPacketsMarkdown(report) {
  const lines = [
    "# On-Market Activation Packets",
    "",
    `Built: ${report.built_at}`,
    report.activation_plan_built_at ? `Activation plan input: ${report.activation_plan_built_at}` : null,
    "",
    `Packets: ${report.summary.total} | credential: ${report.summary.credential_requests} | public-record: ${report.summary.public_record_requests} | verification: ${report.summary.verification_requests} | pull checklist: ${report.summary.pull_checklists}`,
    "",
  ].filter((line) => line !== null);

  for (const packet of report.packets) {
    lines.push(`## ${packet.title}`);
    lines.push(`- Request type: ${packet.request_type}`);
    lines.push(`- Citation: ${packet.citation_file}`);
    lines.push(`- Stage: ${packet.activation_stage}`);
    lines.push(`- Recipient: ${packet.recipient}`);
    lines.push(`- Subject: ${packet.subject}`);
    lines.push(`- Legal basis: ${packet.legal_basis}`);
    lines.push(`- Next registry row: \`${JSON.stringify(packet.registry_row_template)}\``);
    lines.push(`- Do not do: ${packet.do_not_do.join("; ")}`);
    lines.push("");
    lines.push("```text");
    lines.push(packet.request_body);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function packetForSource(source = {}) {
  const stage = source.activation_stage || "blocked_verification";
  const requestType = requestTypeForStage(stage);
  const title = source.title || source.file || "Unknown on-market source";
  const sourceKey = sourceKeyFrom(title, source.file);
  const fields = Array.isArray(source.required_fields) ? source.required_fields.filter(Boolean) : [];
  const freshness = Array.isArray(source.freshness_anchors) ? source.freshness_anchors.filter(Boolean) : [];
  const blockers = Array.isArray(source.blockers) ? source.blockers.filter(Boolean) : [];
  const legalBasis = source.lawful_path || "official/sanctioned source only";
  const recipient = recipientFor({ requestType, title });
  const subject = subjectFor({ requestType, title });
  const registryRow = registryRowFor({ sourceKey, source, requestType });

  return {
    source_key: sourceKey,
    title,
    citation_file: source.file || "",
    activation_stage: stage,
    request_type: requestType,
    recipient,
    subject,
    legal_basis: legalBasis,
    request_body: requestBodyFor({ requestType, title, fields, freshness, blockers, legalBasis }),
    registry_row_template: registryRow,
    do_not_do: [
      "do not scrape Zillow, Redfin, Realtor.com, CoStar, or people-search sites",
      "do not bypass CAPTCHA, Cloudflare, login walls, or contractual source restrictions",
      "do not expose owner, agent, phone, or email contacts without the compliance gate",
    ],
  };
}

function requestTypeForStage(stage) {
  if (stage === "ready_to_pull") return "bounded_pull_checklist";
  if (stage === "blocked_credentials") return "credential_scope";
  if (stage === "blocked_public_records") return "public_record_bulk";
  return "source_verification";
}

function recipientFor({ requestType, title }) {
  if (requestType === "credential_scope") return "MLS data-access / broker compliance contact";
  if (requestType === "public_record_bulk") return `${agencyName(title)} public-records / FOIA office`;
  if (requestType === "bounded_pull_checklist") return "internal connector operator";
  return `${agencyName(title)} source owner or public web contact`;
}

function subjectFor({ requestType, title }) {
  if (requestType === "credential_scope") return "Confirm RESO Web API access scope and OAuth2 credentials for internal deal analysis";
  if (requestType === "public_record_bulk") return `Public-record bulk inventory request for ${agencyName(title)} on-market real property`;
  if (requestType === "bounded_pull_checklist") return `Bounded delta pull checklist for ${agencyName(title)}`;
  return `Verify official ${agencyName(title)} listing path, fields, and freshness cadence`;
}

function requestBodyFor({ requestType, title, fields, freshness, blockers, legalBasis }) {
  const wantedFields = fields.length ? fields.join(", ") : "situs, list price, status, listing id, and freshness timestamp";
  const freshnessText = freshness.length ? freshness.join("; ") : "source_pull_ts plus the source's authoritative last-modified or listing date";
  const blockerText = blockers.length ? blockers.join("; ") : "no blockers recorded";

  if (requestType === "bounded_pull_checklist") {
    return [
      `Source: ${title}`,
      "Run only a bounded delta pull after access terms are recorded.",
      `Validate fields: ${wantedFields}.`,
      `Validate freshness anchors: ${freshnessText}.`,
      "Write only a small manifest/count report until field coverage is proven.",
    ].join("\n");
  }

  if (requestType === "credential_scope") {
    return [
      "Please confirm whether our permitted access scope allows internal CRM/deal-analysis use of active listing data through the RESO Web API.",
      `Needed fields: ${wantedFields}.`,
      `Needed freshness anchors: ${freshnessText}.`,
      "Please provide or authorize the RESO base URL, OAuth2 client-credentials flow, rate limits, attribution rules, and any field-level restrictions.",
      `Current blocker: ${blockerText}.`,
      `Use case basis: ${legalBasis}.`,
    ].join("\n");
  }

  if (requestType === "public_record_bulk") {
    return [
      "I am requesting a bulk public-record extract for active or recently changed real-property sale/auction/REO inventory.",
      `Requested fields: ${wantedFields}.`,
      `Requested freshness/cadence metadata: ${freshnessText}.`,
      "Preferred delivery: CSV, JSON, fixed-width, API, or recurring email/export. A small sample file is enough to validate the connector first.",
      `Current blocker: ${blockerText}.`,
      `Use case basis: ${legalBasis}.`,
    ].join("\n");
  }

  return [
    "Please confirm the current official listing/search URL, machine-readable export options, field availability, and refresh cadence.",
    `Fields to verify: ${wantedFields}.`,
    `Freshness anchors to verify: ${freshnessText}.`,
    `Current blocker: ${blockerText}.`,
    `Use case basis: ${legalBasis}.`,
  ].join("\n");
}

function registryRowFor({ sourceKey, source, requestType }) {
  return {
    source: sourceKey,
    access_status: requestType === "bounded_pull_checklist" ? "ready_to_pull" : "blocked_pending_response",
    lawful_path: source.lawful_path || "official/sanctioned source only",
    credential_or_bulk_path: credentialPathFor(requestType),
    cadence: inferCadence(source.freshness_anchors),
    last_fetched: null,
    terms_recorded: false,
    contact_fields_gated: true,
    citation: source.file || "",
  };
}

function credentialPathFor(requestType) {
  if (requestType === "credential_scope") return "mls_dua_oauth2";
  if (requestType === "public_record_bulk") return "agency_public_record_or_foia_bulk";
  if (requestType === "bounded_pull_checklist") return "recorded_terms_delta_pull";
  return "official_path_verification";
}

function inferCadence(anchors = []) {
  const text = anchors.map(str).join(" ").toLowerCase();
  if (text.includes("nightly")) return "nightly";
  if (text.includes("daily")) return "daily";
  if (text.includes("recurring")) return "recurring_unconfirmed";
  return "unconfirmed";
}

function sourceKeyFrom(title, file) {
  const base = str(file).match(/pilot-manifest-onmarket-([^/\\]+?)(?:-\d{4}-\d{2}-\d{2})?\.md$/)?.[1]
    || str(title).toLowerCase();
  return base
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    || "onmarket_source";
}

function agencyName(title) {
  const t = str(title);
  if (/reso|mls/i.test(t)) return "RESO/MLS";
  if (/fdic/i.test(t)) return "FDIC";
  if (/hud/i.test(t)) return "HUD";
  if (/usda/i.test(t)) return "USDA Rural Development";
  if (/gsa/i.test(t)) return "GSA";
  return "official source";
}
