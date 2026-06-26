# Connector Registry + RESO Web API spec
### *The "go to the source Zillow pulls from" path, built as the first `code:connector` Thinga*

> **Why this doc:** two design threads converge here.
> 1. **"Don't scrape Zillow — license the MLS feed Zillow itself ingests"** (the source-not-the-wall principle; see `rulesreg/_scraping/`).
> 2. **The connector registry / `code:connector` Thinga layer** (see `THINGA_MIGRATION.md` §4, iter 10).
>
> They are the same move. This spec builds RESO as the **first real connector**, shaped so it serves the campaign engine *today* and drops into the Ankhor substrate *unchanged* later.

---

## 1. The problem with `executeCampaign` today

`executeCampaign(c)` is hardwired to one source — it calls `rentcastGet("/listings/sale", …)` directly, maps RentCast's field names inline, and dedups into `properties`. Detroit's pulls (`pullBlightTickets`, `detroitComps`) are *separate* hardwired functions. Adding "Zillow-grade on-market data" by bolting another `if` into `executeCampaign` repeats the mistake.

The fix is the interface every source already implies:

```js
// A connector is one object. Every source — RentCast, Detroit ArcGIS, RESO/MLS — is one of these.
Connector = {
  id,            // "reso-mls", "rentcast-sale", "detroit-blight"
  region,        // "us" | "us-mi-wayne" | …
  type,          // "listings" | "violations" | "parcels" | "comps"
  search(target) // (campaign filters) → [normalizedLead]   ← the ONLY method
}
```

`registry[connectorId].search(campaign)` replaces the inline RentCast call. Detroit's three functions become the first three connectors. **Adding a city or a country becomes a registry entry, not a code change.**

## 2. Why RESO first — it *is* Zillow's data, legally

Zillow/Realtor.com display **MLS listings ingested via the RESO Web API**. You can license that same feed directly through an aggregator:

| Aggregator | Notes |
|---|---|
| **Bridge Interactive** (Zillow Group) | free/low-cost RESO access for many MLSs once approved |
| **Trestle** (CoreLogic) | broad MLS coverage, RESO Web API |
| **SimplyRETS** | dev-friendly, fastest to integrate, RESO + sandbox |
| **Spark API** (FBS) | RESO, strong for FlexMLS markets |

You get the *same clean, complete, real-time on-market data Zillow shows* — no proxies, no CAPTCHAs, no IP bans, no ToS landmine. That is the entire "skip the scraping arms race" payoff, realized.

## 3. The RESO connector (drop-in for `server.js`)

RESO Web API speaks **OData**: `GET /Property?$filter=…&$top=…`. The connector maps a campaign to an `$filter` and maps RESO field names to the CRM's `properties` shape — the same normalization `executeCampaign` already does for RentCast, just behind the interface.

```js
// connectors/reso.js  — sketch
const RESO_FIELD = {
  // RESO StandardName            // CRM properties column
  UnparsedAddress:  "formatted_address",
  StreetName:       "address",
  City:             "city",   StateOrProvince: "state",  PostalCode: "zip",
  ListPrice:        "price",  DaysOnMarket:    "days_on_market",
  BedroomsTotal:    "bedrooms", BathroomsTotalInteger: "bathrooms",
  LivingArea:       "square_footage", YearBuilt: "year_built",
  StandardStatus:   "status", ListingId: "source_id",
  Latitude: "latitude", Longitude: "longitude",
  ListAgentFullName: "listing_agent_name", ListAgentPreferredPhone: "listing_agent_phone",
  ListAgentEmail:    "listing_agent_email",
};

export const resoConnector = {
  id: "reso-mls", region: "us", type: "listings",
  async search(c) {
    const key  = getSetting("reso_token")   || process.env.RESO_TOKEN;
    const base = getSetting("reso_base_url") || process.env.RESO_BASE_URL; // aggregator-specific
    if (!key || !base) throw new Error("Connect RESO (Bridge/Trestle/SimplyRETS) in Acquisitions first.");

    // ── ENFORCE THE LEAD SPEC: on-market, NEVER sold ──
    const f = ["StandardStatus eq 'Active'"];               // never 'Closed'/'Sold'
    if (c.city)  f.push(`City eq '${c.city.replace(/'/g,"''")}'`);
    if (c.state) f.push(`StateOrProvince eq '${c.state}'`);
    if (c.zip)   f.push(`PostalCode eq '${c.zip}'`);
    if (c.price_min) f.push(`ListPrice ge ${c.price_min}`);
    if (c.price_max) f.push(`ListPrice le ${c.price_max}`);
    if (c.beds_min)  f.push(`BedroomsTotal ge ${c.beds_min}`);
    if (c.baths_min) f.push(`BathroomsTotalInteger ge ${c.baths_min}`);
    if (c.sqft_min)  f.push(`LivingArea ge ${c.sqft_min}`);
    if (c.days_on_market_min) f.push(`DaysOnMarket ge ${c.days_on_market_min}`);

    const url = new URL(base.replace(/\/$/,"") + "/Property");
    url.searchParams.set("$filter", f.join(" and "));
    url.searchParams.set("$top", "500");
    url.searchParams.set("$orderby", "ModificationTimestamp desc");

    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`RESO ${r.status}: ${(await r.text()).slice(0,180)}`);
    const rows = (await r.json()).value || [];

    // normalize to the CRM's listing shape (same target as the RentCast branch)
    return rows.map((L) => {
      const o = { source: "reso" };
      for (const [reso, col] of Object.entries(RESO_FIELD)) if (L[reso] != null) o[col] = L[reso];
      return o;
    });
  },
};
```

## 4. Wiring it in — minimal change to `executeCampaign`

Refactor the source pull out of `executeCampaign`; keep its existing scoring/dedup/`properties` write untouched:

```js
import { registry } from "./connectors/index.js"; // { "rentcast-sale": …, "reso-mls": …, "detroit-blight": … }

async function executeCampaign(c) {
  const sources = (c.sources || "rentcast-sale").split(","); // campaigns gain a `sources` column (one migration line)
  const listings = [];
  for (const id of sources) {
    const conn = registry[id]; if (!conn) continue;
    try { listings.push(...await conn.search(c)); }
    catch (e) { console.error(`connector ${id} failed:`, e.message); }
  }
  // … existing per-listing scoreListing → blendLead → INSERT/UPDATE properties stays exactly as-is …
}
```

`registry["rentcast-sale"]` wraps the current RentCast block verbatim; `registry["detroit-blight"]` wraps `pullBlightTickets`. **One campaign can now fan across RentCast + RESO + Detroit with the same target filters.**

## 5. How RESO meets the lead spec (on/off-market, never sold, contact on every lead)

- **Never sold** — enforced at the source: `StandardStatus eq 'Active'`. Sold MLS records are excluded as leads (and, per the comps rule, reused as ARV fuel via a *separate* `type:"comps"` RESO query on `StandardStatus eq 'Closed'`).
- **On-market** — RESO is the on-market half. Off-market stays the Detroit/county signal connectors (violations, tax-delinquent, absentee).
- **Contact on every lead** — RESO gives the **listing agent's** phone/email (already mapped). For the **owner's** number → the `code:skiptrace` connector (BatchData) appends it; if that returns nothing → the **research-agent fallback** (`lead-sources-onoff-with-contact.md` Tier 5). No lead is dropped.

## 6. Why this is the first `code:connector` Thinga

In the Ankhor substrate, this connector object *is* a `kind:code` Thinga: `content` = the field map + region/type, `code.ref` = a registered `search` handler (no `eval`, the 5DEngine `handlers.js` pattern). So:

- **Today:** `registry["reso-mls"].search(campaign)` — plain JS, ships now.
- **After Thinga migration:** `INVOKE thinga:connector.reso-mls { target }` — identical behavior, now a citizen of the substrate, discoverable/composable like everything else.

Building RESO now is therefore not throwaway — it is **iter 10 pulled forward**, and the proof that the registry pattern and the substrate are the same idea.

---

### Next steps (pick the entry point)
1. **Ship RESO standalone** — `connectors/reso.js` + the `sources` column + the `executeCampaign` refactor, on branch `connector-registry`. App stays green; you gain Zillow-grade on-market data legally.
2. **Then fold Detroit + RentCast into the registry** — three connectors, one interface.
3. **Then (with go-ahead) the Thinga loop** — connectors become `code:connector` Thingas; see `THINGA_MIGRATION.md`.

To wire RESO you need one thing from a human: a **RESO aggregator account** (SimplyRETS is the fastest sandbox) → its `base_url` + token. Drop those in and the connector is live.
