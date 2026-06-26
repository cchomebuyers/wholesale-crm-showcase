// connectors/reso.js — the RESO Web API connector ("go to the source Zillow pulls from").
//
// Zillow/Realtor display MLS listings ingested via RESO. License the same feed (Bridge / Trestle /
// SimplyRETS) and you get clean on-market data legally, no bot walls. SCAFFOLDED: the live OData call
// is gated on a RESO aggregator token (carry-forward unblock: SimplyRETS sandbox). Without a token,
// search() returns [] (never throws) so it's safe to list in a campaign's sources today.
//
// The lead spec is enforced AT THE SOURCE: StandardStatus eq 'Active' ⇒ never a sold record.

// RESO StandardName → the CRM's normalized property field.
export const RESO_FIELD = {
  UnparsedAddress: "formatted_address",
  City: "city", StateOrProvince: "state", PostalCode: "zip",
  ListPrice: "price", DaysOnMarket: "days_on_market",
  BedroomsTotal: "bedrooms", BathroomsTotalInteger: "bathrooms",
  LivingArea: "square_footage", YearBuilt: "year_built",
  StandardStatus: "status", ListingId: "source_id",
  Latitude: "latitude", Longitude: "longitude",
  ListAgentFullName: "listing_agent_name", ListAgentPreferredPhone: "listing_agent_phone",
  ListAgentEmail: "listing_agent_email",
};

// Pure, testable: build the OData $filter for a campaign. Active-only ⇒ the "never sold" guarantee.
export function buildResoFilter(c) {
  const q = (s) => String(s).replace(/'/g, "''");
  const f = ["StandardStatus eq 'Active'"]; // never 'Closed'/'Sold'
  if (c.city) f.push(`City eq '${q(c.city)}'`);
  if (c.state) f.push(`StateOrProvince eq '${q(c.state)}'`);
  if (c.zip) f.push(`PostalCode eq '${q(c.zip)}'`);
  if (c.price_min) f.push(`ListPrice ge ${Number(c.price_min)}`);
  if (c.price_max) f.push(`ListPrice le ${Number(c.price_max)}`);
  if (c.beds_min) f.push(`BedroomsTotal ge ${Number(c.beds_min)}`);
  if (c.baths_min) f.push(`BathroomsTotalInteger ge ${Number(c.baths_min)}`);
  if (c.sqft_min) f.push(`LivingArea ge ${Number(c.sqft_min)}`);
  if (c.days_on_market_min) f.push(`DaysOnMarket ge ${Number(c.days_on_market_min)}`);
  return f.join(" and ");
}

// A RESO Property record → the normalized property shape.
export function normalizeReso(L) {
  const o = { source: "reso" };
  for (const [reso, col] of Object.entries(RESO_FIELD)) if (L[reso] != null) o[col] = L[reso];
  if (!o.formatted_address) return null;
  o.addr_key = String(o.formatted_address).toLowerCase();
  return o;
}

export function resoConnector(deps) {
  return {
    id: "reso-mls", region: "us", type: "listings",
    async search(c) {
      const token = deps.getSetting("reso_token") || process.env.RESO_TOKEN;
      const base = deps.getSetting("reso_base_url") || process.env.RESO_BASE_URL;
      if (!token || !base) return []; // not configured — skip silently (carry-forward unblock)
      // Live MLS call intentionally NOT wired until a token is provided. The query is ready:
      //   GET `${base}/Property?$filter=${buildResoFilter(c)}&$top=500&$orderby=ModificationTimestamp desc`
      //   headers: { Authorization: `Bearer ${token}` }; rows.map(normalizeReso)
      return [];
    },
  };
}
