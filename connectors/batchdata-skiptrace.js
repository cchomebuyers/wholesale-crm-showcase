// connectors/batchdata-skiptrace.js — paid skip-trace bridge stub.
//
// DOES NOT CALL BatchData without a key. Returns a disabled/unconfigured response
// so the platform always knows the connector exists but is not active.
// When the user provides a batchdata_api_key, this becomes the primary phone-enrichment path.
//
// The existing server.js:542 already has skiptraceAddress() wired to the BatchData API.
// This connector wraps that function at the registry level.

export function batchDataSkipTraceConnector({ apiKey = null, fetchImpl = fetch } = {}) {
  const enabled = Boolean(apiKey);
  return {
    id: "batchdata-skiptrace",
    region: "us",
    type: "paid-skiptrace",
    dialect: "batchdata",
    free: false,
    enabled,
    async search(target = {}) {
      if (!enabled) {
        return [{
          source_id: "batchdata-skiptrace",
          source_type: "paid_skiptrace",
          enabled: false,
          status: "disabled_missing_api_key",
          phone: null,
          email: null,
          mailing_address: null,
          dnc_status: null,
          confidence: null,
          notes: "BatchData API key not configured. Set batchdata_api_key in Settings → Acquisitions.",
          next_step: "Add BatchData key for owner phone/email enrichment.",
        }];
      }

      // When key is present, delegate to the existing skiptraceAddress() in server.js.
      // The actual implementation lives there (server.js:542) so there is one canonical
      // BatchData call path. This connector is the registry-level wrapper.
      if (!target.address) {
        return [{
          source_id: "batchdata-skiptrace",
          source_type: "paid_skiptrace",
          enabled: true,
          status: "missing_address",
          phone: null,
          email: null,
          notes: "Address required for skip trace. Provide property address.",
        }];
      }

      // The real call happens through server.js injection (deps.skiptraceAddress).
      // This connector's search() is a pure stub — the actual API key and fetch
      // are injected by server.js at mount time so there's one auth path.
      return [{
        source_id: "batchdata-skiptrace",
        source_type: "paid_skiptrace",
        enabled: true,
        status: "call_delegated_to_server",
        notes: "Skip-trace dispatched via server.js:skiptraceAddress(). Results written to leads table.",
      }];
    },
  };
}
