// consent.js -- first-party consent: the cleanest, most defensible contact route.
//
// When a seller submits their own info on our landing page and explicitly opts in, they create a
// CONSENT EDGE. Express written consent (TCPA) is the lawful basis to contact them on the channels
// they chose — so this is the ONE path that flips outreach_allowed:true WITHOUT paid skip-trace.
// Pure: no I/O. makeConsentRecord captures the consent; consentToContactCandidate maps it to the
// fields compliance_gate reads, so the gate ALLOWS exactly the consented channels (and nothing more).

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const VALID_CHANNELS = ["call", "sms", "email", "mail"];

/**
 * @param {object} input - { name, phone?, email?, address?, channels?: string[], consent?: bool,
 *                            source?, offer?, timestamp? }
 * @returns consent record, or { valid:false, reason } when no usable consent.
 */
export function makeConsentRecord(input = {}) {
  const name = str(input.name || input.seller_name);
  const phone = str(input.phone).replace(/[^\d]/g, "");
  const email = str(input.email);
  const consented = input.consent === true || input.consent === "true" || input.consent === 1;
  const channels = (Array.isArray(input.channels) ? input.channels : [])
    .map((c) => str(c).toLowerCase()).filter((c) => VALID_CHANNELS.includes(c));

  if (!consented) return { valid: false, reason: "no explicit opt-in checkbox" };
  if (!name) return { valid: false, reason: "missing name" };
  if (!channels.length) return { valid: false, reason: "no channel selected" };
  // each chosen channel needs the contact field it uses
  const need = { call: phone, sms: phone, email, mail: str(input.address) };
  const missing = channels.filter((c) => !need[c]);
  if (missing.length) return { valid: false, reason: `consented to ${missing.join("/")} but no ${missing.map((c) => (c === "email" ? "email" : c === "mail" ? "address" : "phone")).join("/")} provided` };

  return {
    valid: true,
    name,
    phone: phone || null,
    email: email || null,
    address: str(input.address) || null,
    channels,
    consent: true,
    source: str(input.source) || "first_party_landing",
    offer: str(input.offer) || null,
    timestamp: input.timestamp || new Date().toISOString(),
    legal_basis: "first_party_express_consent",
  };
}

/**
 * Turn a valid consent record into a contact candidate whose compliance fields permit ONLY the
 * channels the seller opted into. Express consent is a lawful call basis (treated as DNC-clear for
 * the consented call channel); SMS/email get explicit consent flags. Channels not chosen stay denied.
 */
export function consentToContactCandidate(consent = {}) {
  if (!consent || consent.valid === false) return null;
  const ch = new Set(consent.channels || []);
  return {
    phone: consent.phone || null,
    email: consent.email || null,
    dnc_status: ch.has("call") ? "clear" : "", // express consent = lawful call basis for consented channel
    sms_consent: ch.has("sms"),
    email_consent: ch.has("email"),
    opt_out: false,
    consent_basis: "first_party_express_consent",
    consent_channels: [...ch],
    source: consent.source,
  };
}
