// seller_intake.js -- operator-facing queue for first-party seller consent leads.
//
// Seller landing pages create consent records. This read model turns those records
// into a daily intake queue without mixing them into scraped/skip-traced seller
// contacts. First-party consent is the clean route; the queue should make that
// explicit and preserve the allowed channels.

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const parseChannels = (v) => {
  if (Array.isArray(v)) return v.map((c) => str(c).toLowerCase()).filter(Boolean);
  if (!str(v)) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map((c) => str(c).toLowerCase()).filter(Boolean);
  } catch {
    // Fall through to comma parsing.
  }
  return str(v).split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
};

const clampLimit = (v, fallback = 50, max = 500) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
};

export function buildSellerIntakeQueue({ consentRecords = [], limit = 50 } = {}) {
  const items = consentRecords.map(intakeItem).sort(compareIntake);
  const visible = items.slice(0, clampLimit(limit));
  const allowedChannelCounts = {};
  const priorityCounts = {};
  for (const item of items) {
    priorityCounts[item.priority] = (priorityCounts[item.priority] || 0) + 1;
    for (const ch of item.compliance.allowed_channels) {
      allowedChannelCounts[ch] = (allowedChannelCounts[ch] || 0) + 1;
    }
  }
  return {
    built_at: new Date().toISOString(),
    summary: {
      consent_records: consentRecords.length,
      returned: visible.length,
      first_party_contactable: items.filter((i) => i.compliance.outreach_allowed).length,
      priority_counts: priorityCounts,
      allowed_channel_counts: allowedChannelCounts,
    },
    items: visible,
    citations: [
      { claim: "first-party consent source", module: "consent.js#makeConsentRecord" },
      { claim: "compliance-gated outreach", module: "compliance_gate.js#complianceCheck" },
      { claim: "seller intake read model", module: "seller_intake.js#buildSellerIntakeQueue" },
    ],
  };
}

function intakeItem(record = {}) {
  const channels = parseChannels(record.channels);
  const hasAddress = Boolean(str(record.address));
  const canCall = channels.includes("call");
  const canText = channels.includes("sms");
  const hasFastChannel = canCall || canText;
  const hasCashOfferIntent = /cash offer|offer/i.test(str(record.offer));
  const priorityScore = (hasFastChannel ? 45 : 0) + (hasAddress ? 25 : 0) + (hasCashOfferIntent ? 20 : 0) + 10;
  const priority = priorityScore >= 80 ? "hot" : priorityScore >= 55 ? "warm" : "review";
  return {
    id: record.id ?? null,
    created_at: record.created_at || null,
    seller: {
      name: str(record.name) || null,
      phone: str(record.phone) || null,
      email: str(record.email) || null,
      address: str(record.address) || null,
    },
    request: {
      source: str(record.source) || "first_party_landing",
      offer: str(record.offer) || null,
      legal_basis: str(record.legal_basis) || "first_party_express_consent",
    },
    priority,
    priority_score: priorityScore,
    next_action: nextAction({ channels, hasAddress }),
    compliance: {
      outreach_allowed: channels.length > 0,
      allowed_channels: channels,
      consent_basis: "first_party_express_consent",
      reason: channels.length
        ? "seller submitted first-party express consent for the listed channels"
        : "no consented channel recorded",
    },
  };
}

function nextAction({ channels, hasAddress }) {
  if (channels.includes("call")) return hasAddress ? "call seller about cash offer" : "call seller and confirm property address";
  if (channels.includes("sms")) return hasAddress ? "text seller about cash offer" : "text seller and confirm property address";
  if (channels.includes("email")) return hasAddress ? "email seller about cash offer" : "email seller and confirm property address";
  return "review consent record before outreach";
}

function compareIntake(a, b) {
  const scoreDelta = b.priority_score - a.priority_score;
  if (scoreDelta) return scoreDelta;
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}
