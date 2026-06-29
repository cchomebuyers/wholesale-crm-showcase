// compliance_gate.js -- the authoritative outreach gate. A found phone/email is NEVER callable
// just because a route returned it. Outreach is allowed only when, per jurisdiction and channel,
// the contact clears DNC + consent + opt-out checks. Default is DENY. This overrides any source
// that claims outreach_allowed:true. Pure: no I/O — callers inject the check results.
//
// US: FCC/TCPA (robocalls/robotexts generally need prior express consent), FTC Do-Not-Call for
// telemarketing. Canada: CRTC National DNCL registration + CASL consent/ID/unsubscribe for CEMs
// (incl. SMS/email). Direct mail is not gated by DNC/TCPA/CASL.

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const CHANNELS = ["call", "sms", "email", "mail"];

function deny(channel, reason) { return { channel, allowed: false, reason }; }

/**
 * @param {object} candidate - { phone?, email?, dnc_status?, sms_consent?, email_consent?, opt_out?, line_type? }
 * @param {object} ctx - { channels?: string[], jurisdiction?: string[], use_case?: string }
 * @returns {{ outreach_allowed, per_channel, reasons, status }}
 */
export function complianceCheck(candidate = {}, ctx = {}) {
  const channels = (ctx.channels && ctx.channels.length ? ctx.channels : CHANNELS).filter((c) => CHANNELS.includes(c));
  const dnc = str(candidate.dnc_status);          // "clear" | "listed" | "" (unknown)
  const optOut = candidate.opt_out === true;
  const hasPhone = str(candidate.phone).length >= 7;
  const hasEmail = /.+@.+\..+/.test(str(candidate.email));
  const smsConsent = candidate.sms_consent === true;
  const emailConsent = candidate.email_consent === true;

  const per_channel = channels.map((channel) => {
    if (optOut) return deny(channel, "contact has opted out");
    if (channel === "mail") {
      return { channel, allowed: true, reason: "direct mail not restricted by DNC/TCPA/CASL" };
    }
    if (channel === "call") {
      if (!hasPhone) return deny("call", "no phone on file");
      if (dnc !== "clear") return deny("call", dnc === "listed" ? "on Do-Not-Call list" : "DNC not checked");
      return { channel, allowed: true, reason: "phone present and DNC clear" };
    }
    if (channel === "sms") {
      if (!hasPhone) return deny("sms", "no phone on file");
      if (!smsConsent) return deny("sms", "no prior express consent for SMS (TCPA/CASL)");
      if (dnc === "listed") return deny("sms", "on Do-Not-Call list");
      return { channel, allowed: true, reason: "phone + SMS consent" };
    }
    if (channel === "email") {
      if (!hasEmail) return deny("email", "no email on file");
      if (!emailConsent) return deny("email", "no consent for commercial email (CASL/CAN-SPAM)");
      return { channel, allowed: true, reason: "email + consent" };
    }
    return deny(channel, "unknown channel");
  });

  const allowedChannels = per_channel.filter((c) => c.allowed).map((c) => c.channel);
  const outreach_allowed = allowedChannels.length > 0;
  return {
    outreach_allowed,
    allowed_channels: allowedChannels,
    per_channel,
    reasons: per_channel.map((c) => `${c.channel}: ${c.allowed ? "ALLOW" : "BLOCK"} (${c.reason})`),
    status: outreach_allowed ? "outreach_permitted_on_some_channel" : "blocked_until_compliance_cleared",
  };
}

/** Force any source-supplied claim back to the gated default — the gate is authoritative. */
export function gateContactCandidate(candidate = {}) {
  return {
    ...candidate,
    outreach_allowed: false,
    compliance_status: "unchecked",
    compliance_note: "phone/email (if found) stays outreach_allowed:false until DNC/consent verified",
  };
}
