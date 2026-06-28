# Industrial Lead Failure Simulation

This is the expected failure profile for the industrial real-estate lead system,
and the fixes now wired into the faceted `realEstate` layer.

## What Would Go Wrong

1. Duplicate property records would look like separate leads.

Example: `123 Industrial Street`, `123 INDUSTRIAL ST`, and an EPA facility record
for the same site. Without canonical address keys, the system would chase one
property three times.

Fix: `realEstateIdentityKeys()` now creates parcel, address, source, and geo
keys. `mergeRealEstateThingas()` merges records that share parcel/address/geo
identity and preserves the originals as children.

2. Operator phones would be mistaken for owner phones.

Example: NYC business license or EPA facility data may identify the tenant,
operator, or facility, not the deed owner.

Fix: contact evidence carries `contact_relation`. Agent/operator/tenant phones
stay contactable evidence but do not become owner phones.

3. Weak distress would be treated as seller intent.

Example: a code violation is a reason to investigate, not proof the owner wants
to sell.

Fix: source facts stay in `distress`; motivation claims stay in `inference`.

4. Sold properties would enter the lead pipeline.

Example: comps are useful for ARV but should not become seller leads.

Fix: sold records parse as `sale_status: "sold"` and route as comps/valuation
evidence.

5. Outreach would happen before compliance.

Example: a phone exists, but DNC/consent has not been checked.

Fix: the simulator flags every contact without `allowed_to_call: true` as
`COMPLIANCE_BLOCK`. Existing contact routing also marks candidates
`outreach_allowed: false`.

6. Listings without real active status would be treated as live deals.

Example: blank/unknown status from a public property source.

Fix: listing outreach requires active listing evidence. Blank status remains
unknown.

7. Source failures would hide coverage gaps.

Example: a county source returns no owner field, but the system assumes owner is
unknown rather than requiring owner-resolution.

Fix: simulator emits `NO_OWNER` and routes to assessor/tax-roll/recorder
resolution.

## Code Added

- `industrial_lead_simulator.js`
- `industrial_lead_simulator.test.js`

The simulator produces:

```js
{
  thingas,
  failures,
  merges
}
```

Failure types:

- `duplicate_property`
- `contact_not_owner`
- `not_for_sale`
- `no_owner`
- `no_contact`
- `compliance_block`
- `weak_distress`

## Correct Runtime Behavior

The system should run like this:

```txt
source result
  -> makeRealEstateFacetedThinga()
  -> parseRealEstateThinga(strict)
  -> identity-key match
  -> merge same property
  -> score
  -> owner/contact resolution
  -> compliance gate
  -> outreach task only after cleared
```

The test suite now proves the dangerous cases are caught before they become
outreach actions.

