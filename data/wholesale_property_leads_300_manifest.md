# Wholesale Property Leads 300 Manifest

Generated: 2026-06-28

## Scope

This is the property-first wholesale candidate set. It intentionally excludes public-contact / B2B phone-bearing business/operator records.

Files:

```txt
data/wholesale_property_leads_300.jsonl
data/wholesale_property_leads_300_hot.jsonl
data/wholesale_property_leads_300_summary.json
```

## Counts

```txt
total candidates: 300
source: cook-il-violations
score >= 60: 300
score >= 70: 28
with city/state/county: 300
with owner: 0
with listing contact: 0
with price: 0
with ARV: 0
B2B/operator phone records counted: 0
```

## Interpretation

These are real property/distress candidates from official Chicago/Cook County violation data. They are not yet seller-contact-ready and not yet spread-proven.

Do not treat them as call-ready leads until an owner/contact path is resolved.

## Next Steps

1. Join address to Cook County owner/tax-roll source.
2. Add APN/PIN, owner name, owner mailing address, and owner source.
3. Run ARV/comps or licensed listing/AVM source.
4. Only then run paid skip trace on the highest-scoring records.
5. Evaluate wholesale negotiation path with:

```txt
buyer_assignment_price - acquisition_offer_price
```

and keep seller anchor, acquisition offer, buyer current price, and buyer stretch price separate.

## B2B Niche Use

B2B public-contact records may support enrichment only after a property lead exists:

- commercial/industrial operator tracing
- contractor/flipper buyer discovery
- permit applicant context
- LLC/business entity clues

They must not be counted as seller inventory.
