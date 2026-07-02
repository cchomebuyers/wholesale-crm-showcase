# Real Estate Thinga Operating Model

This file captures the current CRM reality, the property-finding workflows, the
identity/contact workflows, the low-spend strategy, the searcher output struct,
and the new `kind: "realEstate"` faceted Thinga rules.

Implementation files:

- `real_estate_facets.js`
- `real_estate_thinga.js`
- `real_estate_search_paths.js`
- `docs/recursive_thinga_architecture.md`

## Current CRM Facts

> **Historical snapshot — stale counts.** The numbers in this section are an early
> 250-row database state and no longer match the live database. For current live
> counts (properties, sources, enrichment, pro-queue tiers) see
> `audit/june30/06-database-live-state.md`, or re-run the audit command behind it.
> Do not trust the figures below as current. The *conclusions* (public
> violation/property records are not confirmed for-sale listings; the CRM has lead
> phone numbers but ~0 verified active for-sale listings with phones) still hold.

As of an early local database check:

- `properties` table: 250 rows
- Source for all 250: `cook-il-violations`
- `properties.status`: blank for all 250
- `listing_agent_phone`: 0 populated
- `listing_agent_email`: 0 populated

Conclusion: these are public violation/property records, not confirmed active
for-sale listings with agent phones.

Separate lead table state:

- `leads` table: 1,046 rows
- active leads: 12
- active leads with a phone: 8
- active leads that look like on-market/listing-agent leads: 0

Bottom line: the CRM has some lead phone numbers, but it currently has 0
verified active for-sale property listings with phone numbers. The next live
listing source should be RentCast with an active key, RESO/MLS if licensed, or
another verified for-sale listing API that exposes listing agent contact fields.

## Real-Estate Thinga Rule

Every future real-estate record becomes:

```js
{
  $header: {
    kind: "realEstate",
    type: "listing | property_signal | public_contact | comps | geocode | skiptrace | workflow | system",
    id: "sha256:<content hash>",
    hash: "sha256:<content hash>",
    $facets: ["source", "property", "inference", "..."],
    parents: [],
    children: []
  },
  content: {
    record_type: "...",
    category_path: "RealEstate/<type>/<sale_status>",
    config_version: "realEstate.facets.v1"
  },
  facets: {
    source: {},
    property: {},
    inference: {}
  }
}
```

Each Thinga has a unique content-hash id. The same property can still appear as
multiple Thingas because different sources produce different evidence. Those
Thingas are merged by identity keys, not by forcing one source to overwrite
another.

## Unique ID And Merge Rules

Every record gets a unique Thinga id from its content. Property equivalence is
decided by identity keys:

1. `parcel:<STATE>:<PARCEL_ID>` - strongest.
2. `address:<CANONICAL_ADDRESS>|<CITY>|<STATE>|<ZIP>` - strong.
3. `geo:<LAT_5_DECIMALS>,<LON_5_DECIMALS>` - useful fallback.
4. `source:<SOURCE_ID>:<SOURCE_ROW_ID>` - same source row only.

Two real-estate Thingas can merge automatically when they share parcel, address,
or geo identity. Source-row identity alone is provenance, not enough to prove
two different source records are the same property.

Merge behavior:

- direct facts stay in their facet
- conflicting sources are preserved as children/evidence
- merged parent receives both child ids
- `audit.merge_keys` records why the merge happened
- phone/contact facts do not become owner facts unless relation is proven

Implemented in `mergeRealEstateThingas()`.

## Search Setup

The executable search-path registry is `real_estate_search_paths.js`.

It exports:

- `PROPERTY_SEARCH_WORKFLOWS`: 100 ways to find property signals.
- `INSTANT_MARKET_WORKFLOWS`: 10 ways to catch new listings quickly.
- `IDENTITY_CONTACT_WORKFLOWS`: 50 ways to resolve owner/contact identity.
- `buildSearchPlan({ market, includePaid })`: turns those paths into workflow records.

The future scheduler should:

```txt
buildSearchPlan()
  -> convert each path to kind:"realEstate", type:"workflow"
  -> attach a connector/capability when one exists
  -> run source paths on cadence
  -> wrap every result with makeRealEstateFacetedThinga()
  -> merge same-property Thingas
  -> score, route, and compliance-gate
```

## 100 Property-Finding Workflows

1. New MLS/RESO active listings.
2. New MLS price drops.
3. MLS back-on-market.
4. MLS expired listings.
5. MLS withdrawn listings.
6. MLS canceled listings.
7. MLS long days-on-market.
8. MLS vacant remarks.
9. MLS estate/probate remarks.
10. MLS fixer/as-is remarks.
11. RentCast new-for-sale listings.
12. RentCast price-reduced listings.
13. RentCast stale listings.
14. Zillow/Redfin-style equivalent via RESO feed.
15. Broker IDX feed if licensed.
16. Realtor association MLS export.
17. Listing agent inventory watch.
18. Investor-owned listing watch.
19. FSBO listing feeds.
20. Craigslist / marketplace manual-review queue.
21. Code violations.
22. Blight tickets.
23. Vacant property registry.
24. Rental inspection failures.
25. Certificate of occupancy failures.
26. Fire inspection violations.
27. Unsafe structure notices.
28. Demolition orders.
29. Nuisance abatement records.
30. Board-up permits.
31. Building permits.
32. Expired permits.
33. Open permits older than 180 days.
34. Stop-work orders.
35. Roofing permits.
36. Electrical permits.
37. Plumbing permits.
38. HVAC permits.
39. Commercial alteration permits.
40. Owner-builder permits.
41. Tax delinquency rolls.
42. Tax lien sale lists.
43. Sheriff sale lists.
44. Foreclosure notices.
45. Notice of default.
46. Notice of trustee sale.
47. Lis pendens filings.
48. Auction calendars.
49. Bankruptcy property filings.
50. REO/bank-owned records.
51. Absentee owner parcels.
52. Out-of-state owner parcels.
53. Corporate-owned parcels.
54. LLC-owned single-family parcels.
55. Trust-owned parcels.
56. Owner mailing address mismatch.
57. Multiple properties same owner.
58. High equity + absentee.
59. Low assessed value + high ARV.
60. Old purchase date + no mortgage.
61. Probate court filings.
62. Estate transfers.
63. Quitclaim deeds.
64. Interfamily transfers.
65. Divorce filings with property.
66. Guardianship/conservatorship cases.
67. Heirship records.
68. Death records matched to owner.
69. Returned mail / bad mailing address.
70. Owner age + long ownership.
71. Utility shutoff lists where public.
72. Water shutoff liens.
73. Sewer liens.
74. Weed/grass liens.
75. Trash liens.
76. Municipal special assessments.
77. HOA lien filings.
78. Mechanic's liens.
79. Contractor dispute filings.
80. Eviction filings.
81. Rental license registry.
82. Expired rental licenses.
83. Landlord violation lists.
84. Section 8 inspection failure.
85. Tenant complaint records.
86. Short-term rental permits.
87. Short-term rental violations.
88. STR permit expirations.
89. Multi-family inspection records.
90. Lead paint violation records.
91. Industrial facility records.
92. EPA/FRS facility matches.
93. Business license records at property.
94. Alcohol/tobacco/license records.
95. Health inspection failures.
96. Commercial occupancy permits.
97. Zoning variance applications.
98. Planning commission agendas.
99. Rezoning applications.
100. Parcel split/lot consolidation records.

## Instant New-On-Market Workflows

1. MLS/RESO Web API.
2. Broker IDX feed.
3. RentCast sale listings endpoint.
4. CoreLogic/Trestle data distribution.
5. SimplyRETS feed.
6. Listing-agent RSS/email alerts.
7. Saved-search inbox parser.
8. County recording watch.
9. Brokerage website sitemap watcher.
10. Price-change watcher every 10-30 minutes.

## 50 Identity / Contact Workflows

1. Parcel address -> county assessor -> owner name.
2. Parcel address -> tax roll -> taxpayer name.
3. Parcel address -> APN -> owner mailing address.
4. APN -> recorder deeds -> grantee.
5. APN -> mortgage record -> borrower.
6. APN -> tax bill mailing address.
7. Owner name -> other owned parcels.
8. Owner mailing address -> absentee flag.
9. Owner mailing address -> return-mail risk.
10. Owner name + county -> recorder history.
11. LLC owner -> state Secretary of State.
12. LLC owner -> registered agent.
13. LLC owner -> principal office.
14. LLC owner -> annual report.
15. LLC owner -> manager/member if public.
16. LLC address -> business license.
17. LLC name -> permit applicant.
18. LLC name -> contractor license.
19. LLC name -> court filings.
20. LLC name -> UCC filings.
21. Property address -> business license at address.
22. Property address -> permit applicant.
23. Property address -> inspection contact.
24. Property address -> fire inspection contact.
25. Property address -> health inspection contact.
26. Property address -> rental license owner.
27. Property address -> short-term rental permit owner.
28. Property address -> code violation responsible party.
29. Property address -> nuisance abatement contact.
30. Property address -> zoning application applicant.
31. For-sale listing -> listing agent name.
32. For-sale listing -> listing agent phone.
33. For-sale listing -> listing agent email.
34. Listing brokerage -> office phone.
35. Listing agent name -> license lookup.
36. Agent license -> brokerage.
37. Agent license -> public phone/email.
38. MLS listing -> co-listing agent.
39. Listing remarks -> owner/occupant clue.
40. Price drop -> agent outreach task.
41. Owner name + address -> BatchData skip trace.
42. Owner name + mailing address -> skip trace.
43. APN + address -> BatchData property skip trace.
44. LLC + registered agent -> business phone source.
45. Business name -> official business license phone.
46. Business name -> EPA/industrial facility match.
47. Business name -> permit/inspection contact.
48. Business name -> website/contact page manual review.
49. Phone found -> reverse match to owner/entity.
50. Email found -> domain/entity match and confidence score.

## Low-Spend Strategy

Good property leads can be found mostly free. Reliable phone numbers at scale
are not free.

Use:

```txt
10,000 free property records
  -> score/rank
  -> keep top 5-10%
  -> resolve owner free when possible
  -> paid skip-trace only top records
  -> phone validation
  -> compliance gate
```

Budget shape:

- public records: $0
- light testing: $0-$50/month
- small operator: $50-$300/month
- serious automated volume: $500-$2,000/month
- paid-data-company style: $2,000+/month

## Current Searcher Struct

The current searcher can emit:

- on-market listing result
- county/violation lead result
- distressed property result
- public contact result
- geocode result
- comps result
- paid skip-trace result

All should now be wrapped into faceted `realEstate` Thingas.

Direct fields stay in direct facets. Read-between-lines logic stays in the
`inference` facet.

Fields to treat as inference, not direct truth:

- `seller_name`: owner, grantee, licensee, business, or responsible party.
- `phone`: business/operator/agent unless proven owner.
- `listing_agent_phone`: agent contact, not seller contact.
- `business_name`: occupant/operator, not necessarily owner.
- `facility_name`: industrial operator/facility, not necessarily owner.
- `ordinance` / `distress`: reason to investigate, not seller intent proof.
- `status`: source-specific; blank does not mean inactive.
- `price_history`: parse before treating as price-drop evidence.
- `owner_mailing`: different from situs implies absentee, not certainty.
- sold/comps: ARV fuel, not leads.
- `legal_status`: source safety, not outreach permission.
- `confidence`: must be standardized.

