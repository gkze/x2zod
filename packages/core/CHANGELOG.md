# @x2zod/core

## 0.6.1

### Patch Changes

- 0e8c3e2: Preserve nested codec transformations and recursive optional types, avoid generated utility type
  collisions, accept empty property names, and reject unsupported record keys before source emission.
  Give exported JSON Schema references their complete validation contract and preserve pattern-matched
  required properties and contradictory bounds without reducing JSON Schema conformance.

  Parse plugin options once per input transition, keep lint autofixes safe around automatic semicolon
  insertion and function hoisting, and make shared build inputs and installed formatter resolution
  consistent.

## 0.6.0

### Minor Changes

- ea583e6: Add deterministic runtime-program emission, stable declaration configuration,
  host-provided document retrieval URIs, and full pinned required-suite support for JSON Schema
  Draft 7, Draft 2019-09, and Draft 2020-12. Add a strict SchemaStore compatibility profile for its
  inert `tsType` and `x-intellij-language-injection` annotations.

## 0.5.0

### Minor Changes

- 8677011: Add a typed generated helper for deep JSON array-item uniqueness.

  Support `uniqueItems` on non-tuple JSON Schema arrays while preserving accepted values. Tuple and
  prefix-item uniqueness remain unsupported.

## 0.4.0

### Minor Changes

- 286c6ea: Add typed, deduplicated generated refinements for exact numeric and Unicode string
  constraints.

  Preserve type-specific keyword applicability without explicit types, support exact `multipleOf`,
  count string lengths by Unicode code point, and lower composite `const` and `enum` values into
  exact tuples and strict objects while preserving special own object keys such as `__proto__`.

## 0.3.0

### Minor Changes

- 90f1136: Add ordered, schema-language-agnostic emission transforms to library compilation and
  reusable targets.

  Introduce a generic property-mapping transform that emits bidirectional Zod codecs, decodes
  declared snake_case keys as camelCase, rejects compile-time and runtime key collisions, and
  encodes values back to their original wire keys.

## 0.2.0

### Minor Changes

- 21b996e: Add public Zod exclusive-union emission support in core.

  Extend JSON Schema lowering with exact `oneOf`, representable sibling assertions, bounded
  `unevaluatedProperties` object composition, validation-inert recognition of `deprecated`,
  `readOnly`, and `writeOnly`, and a pinned Mise `v2026.7.5` acceptance corpus.

### Patch Changes

- ceef406: Harden public readonly contracts, dependency declarations, and shared TypeScript compiler
  policy.

## 0.1.2

### Patch Changes

- Patch release to verify GitHub Actions publishing.

## 0.1.1

### Patch Changes

- Patch release after initial registry bootstrap.

## 0.0.1

### Patch Changes

- Publish the first post-bootstrap patch release.
