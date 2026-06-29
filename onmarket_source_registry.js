const str = (v) => (v === null || v === undefined ? "" : String(v));

export function parseOnMarketManifest(text = "", file = "") {
  const body = str(text);
  const title = firstMatch(body, /^#\s+(.+)$/m) || file;
  const statusLine = firstMatch(body, /\*\*Status:\*\*\s*([^\n]+)/i) || "";
  const lawfulBasis = firstMatch(body, /\*\*Lawful basis:\*\*\s*([^\n]+)/i) || "";
  const primaryBody = body.split(/\n##\s*(?:8\.|\u00a78)\s*/)[0] || body;
  const officialUrls = [...primaryBody.matchAll(/https:\/\/[^\s)`]+/g)].map((m) => m[0]);
  const buildSteps = sectionLines(body, /##\s*(?:\u00a77|7\.)\s*[^\n]*Connector build steps[^\n]*/i);
  const rejectionCriteria = sectionLines(body, /##\s*(?:\u00a76|6\.)\s*[^\n]*Rejection criteria[^\n]*/i);
  const fieldMap = tableRows(sectionBlock(body, /##\s*(?:\u00a73|3\.)\s*[^\n]*Field map[^\n]*/i));
  const freshness = sectionLines(body, /##\s*(?:\u00a74|4\.)\s*[^\n]*Freshness field[^\n]*/i);
  const blockers = blockersFrom(statusLine, buildSteps);
  const status = classifyStatus(statusLine);

  return {
    file,
    title: title.replace(/^Connector-Ready Pilot Manifest\s+[--]\s+/i, "").trim(),
    status,
    status_line: statusLine.trim(),
    lawful_basis: lawfulBasis.trim(),
    official_urls: [...new Set(officialUrls)],
    required_fields: fieldMap.map((row) => row.crm_field).filter(Boolean),
    freshness_anchors: freshness.map(cleanBullet).filter(Boolean),
    blockers,
    next_steps: buildSteps.map(cleanBullet).filter(Boolean),
    rejection_criteria: rejectionCriteria.map(cleanBullet).filter(Boolean),
    readiness_score: readinessScore({ status, fieldMap, freshness, lawfulBasis, blockers }),
  };
}

export function buildOnMarketReadiness(manifests = []) {
  const sources = manifests
    .map((m) => parseOnMarketManifest(m.text, m.file))
    .sort((a, b) => b.readiness_score - a.readiness_score || a.title.localeCompare(b.title));

  const summary = {
    total: sources.length,
    verified: sources.filter((s) => s.status === "verified").length,
    draft: sources.filter((s) => s.status === "draft").length,
    blocked: sources.filter((s) => s.blockers.length > 0).length,
    top_source: sources[0]?.title || null,
  };

  return {
    built_at: new Date().toISOString(),
    summary,
    sources,
    citations: sources.map((s) => ({ claim: `on-market readiness for ${s.title}`, file: s.file })),
  };
}

export function renderOnMarketReadinessMarkdown(report) {
  const lines = [
    "# On-Market Source Readiness",
    "",
    `Built: ${report.built_at}`,
    "",
    `Sources: ${report.summary.total} | verified: ${report.summary.verified} | draft: ${report.summary.draft} | blocked: ${report.summary.blocked}`,
    "",
    "## Ranked Sources",
    "",
  ];

  for (const source of report.sources) {
    lines.push(`### ${source.title}`);
    lines.push(`- Status: ${source.status} (${source.readiness_score}/100)`);
    if (source.file) lines.push(`- Citation: ${source.file}`);
    if (source.official_urls.length) lines.push(`- Official URL: ${source.official_urls[0]}`);
    if (source.blockers.length) lines.push(`- Blockers: ${source.blockers.join("; ")}`);
    else lines.push("- Blockers: none recorded");
    if (source.next_steps.length) lines.push(`- Next step: ${source.next_steps[0]}`);
    if (source.required_fields.length) lines.push(`- Required fields: ${source.required_fields.slice(0, 8).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function classifyStatus(line) {
  const s = line.toLowerCase().trim();
  if (/^verified\b/.test(s)) return "verified";
  if (/^draft\b/.test(s)) return "draft";
  if (/^rejected\b/.test(s)) return "rejected";
  if (s.includes("draft")) return "draft";
  if (s.includes("verified")) return "verified";
  if (s.includes("rejected")) return "rejected";
  return "unknown";
}

function blockersFrom(statusLine, buildSteps) {
  const line = statusLine.toLowerCase();
  const out = [];
  if (line.includes("pending")) out.push(cleanSentence(statusLine.replace(/^.*pending/i, "pending")));
  for (const step of buildSteps) {
    const clean = cleanBullet(step);
    const l = clean.toLowerCase();
    if (l.includes("obtain") || l.includes("confirm") || l.includes("file ") || l.includes("pending")) {
      out.push(clean);
    }
  }
  return [...new Set(out)].slice(0, 5);
}

function readinessScore({ status, fieldMap, freshness, lawfulBasis, blockers }) {
  let score = 20;
  if (status === "verified") score += 35;
  if (status === "draft") score += 15;
  if (lawfulBasis) score += 10;
  if (fieldMap.length >= 5) score += 15;
  if (freshness.length) score += 10;
  score -= Math.min(25, blockers.length * 5);
  return Math.max(0, Math.min(100, score));
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : "";
}

function sectionBlock(text, headingRe) {
  const match = headingRe.exec(text);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const next = rest.search(/\n##\s+/);
  return next === -1 ? rest : rest.slice(0, next);
}

function sectionLines(text, headingRe) {
  return sectionBlock(text, headingRe)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]|\d+\./.test(line));
}

function tableRows(block) {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|\s*-+/.test(line))
    .slice(1)
    .map((line) => {
      const cols = line.split("|").slice(1, -1).map((c) => c.trim().replace(/`/g, ""));
      return { crm_field: cols[0] || "", source_field: cols[1] || "", notes: cols[2] || "" };
    })
    .filter((row) => row.crm_field && !/crm field/i.test(row.crm_field));
}

function cleanBullet(line) {
  return cleanSentence(str(line).replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
}

function cleanSentence(line) {
  return str(line).replace(/\s+/g, " ").trim();
}
