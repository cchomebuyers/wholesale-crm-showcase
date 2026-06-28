# Recursive Real-Estate Thinga Architecture

This is the wholesale CRM's domain-specific layer on top of Ankhor and the
faceted Thinga architecture.

Canonical sources:

- `C:/Users/Quandale Dingle/yearTwo777/synthesis/ANKHOR_ARCHITECTURE.md`
- `C:/Users/Quandale Dingle/fable5/_mythos/kiibashi/fable5/ankhor88/FACETED_THINGA_ARCHITECTURE.md`
- `faceted_thinga.js`
- `real_estate_facets.js`

## Core Rule

Every real-estate object is one recursive Thinga:

```js
{
  $header: {
    kind: "realEstate",
    type: "listing | property_signal | public_contact | comps | geocode | skiptrace | workflow | system",
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

The shape does not change when the source changes. A RentCast listing, a RESO
listing, a Cook County violation, a Detroit comp, an NYC business phone record,
and a BatchData skip-trace response are all `kind: "realEstate"` Thingas with
different facets populated.

## Facet Family

Required facets:

- `source`: provenance, connector id, legal status, raw source status.
- `property`: address, parcel id, geography, physical property facts.
- `inference`: read-between-lines facts, confidence, notes.

Optional facets:

- `listing`: active/sold status, price, DOM, agent contact.
- `owner`: owner name, owner type, mailing address, absentee hint.
- `contact`: phone/email/contact relation.
- `distress`: violation, blight, vacancy, tax, permit, or other pain signal.
- `valuation`: ARV, MAO, rent, repairs, comps.
- `workflow`: stage, next step, route, priority.
- `compliance`: call/text/email permission gates.
- `audit`: source-run metrics.
- `raw`: original payload when explicitly requested.

## Why This Exists

The current CRM has several source shapes:

- on-market listings
- public violations
- generic distressed property records
- business/contact datasets
- geocodes
- comps
- skip-trace responses

They all overlap but do not currently share one enforced schema. The faceted
architecture solves that by making direct facts and inferred facts different
facets of the same recursive object.

## Direct vs Inferred

Direct facts go in their source facet:

- Listing agent phone goes in `listing` and `contact`.
- Owner name from assessor data goes in `owner`.
- Violation text goes in `distress`.
- Sale price from a sold record goes in `valuation`.

Inferred facts go only in `inference`:

- price drop implies motivation
- days on market implies fatigue
- violation implies distress
- owner mailing mismatch implies absentee
- business phone implies contactability, not owner phone
- sold status implies comp, not lead

This prevents the CRM from pretending weak evidence is strong evidence.

## Recursive Children

A complete deal can be one parent `realEstate` Thinga with children:

```txt
realEstate:property
  child -> realEstate:source_run
  child -> realEstate:violation_signal
  child -> realEstate:owner_identity
  child -> realEstate:public_contact
  child -> realEstate:skiptrace_result
  child -> realEstate:valuation
  child -> realEstate:comps
  child -> realEstate:workflow_task
  child -> message/email/call task Thingas
```

The parent is the deal container. The children are evidence, workflow, and
actions. Each child is still a full Thinga and can have its own children.

## CRM Mapping

Existing connector output maps like this:

| Current source | Thinga type | Facets |
|---|---|---|
| `rentcast-sale` | `listing` | `source`, `property`, `listing`, `contact`, `inference` |
| `reso-mls` | `listing` | `source`, `property`, `listing`, `contact`, `inference` |
| county violations | `property_signal` | `source`, `property`, `owner`, `distress`, `inference` |
| `property.js` sources | `property_signal` | `source`, `property`, `distress`, `inference` |
| NYC business licenses | `public_contact` | `source`, `property`, `contact`, `inference` |
| Chicago business licenses | `public_contact` | `source`, `property`, `contact`, `inference` |
| EPA FRS | `public_contact` | `source`, `property`, `contact`, `inference` |
| Detroit comps | `comps` | `source`, `property`, `valuation`, `inference` |
| Census geocode | `geocode` | `source`, `property`, `inference` |
| BatchData | `skiptrace` | `source`, `contact`, `compliance`, `inference` |

## Parser Family

The parser family lives in `real_estate_facets.js`.

Use:

```js
import {
  makeRealEstateFacetedThinga,
  parseRealEstateThinga
} from "./real_estate_facets.js";

const thinga = makeRealEstateFacetedThinga(connectorResult);
const parsed = parseRealEstateThinga(thinga, { mode: "strict" });
```

Lenient parsing is for exploration. Strict parsing is for writes into the
pipeline.

## Future Rule

Every future source should only need:

1. a connector that returns its natural normalized record
2. `makeRealEstateFacetedThinga(record)`
3. parser validation
4. routing based on parsed facets

Do not add a new table or one-off schema just because a source has new fields.
Add a facet or extend a facet parser.

