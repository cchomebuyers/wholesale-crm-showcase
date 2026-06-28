# B2B Phone Asset Location

The public-contact / business-phone harvest is intentionally preserved, but the large files were moved off `C:` to save working disk space.

Current default location:

```text
D:\wholesale-crm-data\b2b-phone-asset
```

`tools/harvest_business_leads.mjs` now writes there by default. Override with `B2B_LEADS_DIR` if needed.

This B2B asset is separate from the property-first wholesale pipeline. Do not confuse these records with homeowner seller leads.

## Wholesale Boundary

Phone-bearing business/operator records are **not** wholesale seller leads by default.

They should not be used to satisfy targets like "find 300 wholesale leads" unless a separate workflow explicitly classifies them as one of these niche cases:

- commercial/industrial operator at the subject property
- likely tenant/operator who can identify ownership or vacancy
- contractor/permit applicant connected to a distressed property
- buyer-discovery candidate, such as a contractor/flipper/landlord
- agent/business contact for an active listing, not the property seller

Default rule:

```text
property-first wholesale lead count = property/listing/violation/parcel sources only
B2B public-contact count = separate asset, outreach_allowed=false, compliance_status=unchecked
```

The B2B asset can support wholesale as enrichment, but it must not be counted as seller inventory.

## Niche Uses Worth Keeping

The B2B asset is not useless, but it belongs downstream of a property lead:

1. **Buyer discovery** — contractors, landlords, remodelers, permit applicants, and property-service businesses can become cash-buyer candidates.
2. **Commercial/industrial operator tracing** — if the property is industrial/commercial, the operator at the address may know ownership, vacancy, access, or sale intent.
3. **Permit/repair intelligence** — contractor phones tied to permits can help estimate rehab history or identify active flippers.
4. **LLC/entity enrichment** — business/operator records can help resolve an LLC, registered office, or responsible party when county data is thin.
5. **Not seller outreach by default** — never call a business/operator record as if it is the homeowner or legal seller without a relation-confidence gate.
