// connectors/rentcast.js — the RentCast sale-listings connector.
// Wraps the existing rentcastGet (injected) and normalizes to the CRM's `properties` shape.
// One connector = one `search(target) → [normalizedListing]`. See dev/plans/6-26-26/02-CONNECTORS.md.

// RentCast listing → the normalized property shape executeCampaign scores + inserts.
export function normalizeRentcast(L) {
  const fa = L.formattedAddress || [L.addressLine1, L.city, L.state, L.zipCode].filter(Boolean).join(", ");
  if (!fa) return null;
  return {
    addr_key: fa.toLowerCase(), source: "rentcast", source_id: L.id || null,
    formatted_address: fa, address: L.addressLine1 || null, city: L.city || null, state: L.state || null,
    zip: L.zipCode || null, county: L.county || null,
    latitude: L.latitude || null, longitude: L.longitude || null,
    property_type: L.propertyType || null, bedrooms: L.bedrooms || null, bathrooms: L.bathrooms || null,
    square_footage: L.squareFootage || null, lot_size: L.lotSize || null, year_built: L.yearBuilt || null,
    status: L.status || null, price: L.price || null, listed_date: L.listedDate || null,
    removed_date: L.removedDate || null, days_on_market: L.daysOnMarket || null,
    price_history: L.history ? JSON.stringify(L.history) : null,
    listing_agent_name: (L.listingAgent && L.listingAgent.name) || (L.listingOffice && L.listingOffice.name) || null,
    listing_agent_phone: (L.listingAgent && L.listingAgent.phone) || (L.listingOffice && L.listingOffice.phone) || null,
    listing_agent_email: (L.listingAgent && L.listingAgent.email) || (L.listingOffice && L.listingOffice.email) || null,
  };
}

export function rentcastConnector(deps) {
  return {
    id: "rentcast-sale", region: "us", type: "listings",
    async search(c) {
      const listings = await deps.rentcastGet("/listings/sale", {
        city: c.city, state: c.state, zipCode: c.zip,
        propertyType: c.property_type, status: c.status || "Active",
        daysOld: c.days_on_market_min || undefined, limit: 500,
      });
      const arr = Array.isArray(listings) ? listings : [];
      return arr.map(normalizeRentcast).filter(Boolean);
    },
  };
}
