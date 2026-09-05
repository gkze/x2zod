# @x2zod/input-json-schema

## 0.6.1

### Patch Changes

- 0e8c3e2: Preserve nested codec transformations and recursive optional types, avoid generated utility type
  collisions, accept empty property names, and reject unsupported record keys before source emission.
  Give exported JSON Schema references their complete validation contract and preserve pattern-matched
  required properties and contradictory bounds without reducing JSON Schema conformance.

  Parse plugin options once per input transition, keep lint autofixes safe around automatic semicolon
  insertion and function hoisting, and make shared build inputs and installed formatter resolution
  consistent.

- Updated dependencies [0e8c3e2]
  - @x2zod/core@0.6.1

## 0.6.0

### Minor Changes

- 7569ff8: Add configurable, primitive-typed inert JSON Schema keywords. Accept exact custom keyword
  names through plugin configuration or repeatable `--inert-keyword NAME=TYPE` CLI flags, preserve
  strict unknown-keyword diagnostics by default, and ignore validated metadata without changing
  generated validation semantics.

## 0.5.0

### Minor Changes

- ea583e6: Add deterministic runtime-program emission, stable declaration configuration,
  host-provided document retrieval URIs, and full pinned required-suite support for JSON Schema
  Draft 7, Draft 2019-09, and Draft 2020-12. Add a strict SchemaStore compatibility profile for its
  inert `tsType` and `x-intellij-language-injection` annotations.

### Patch Changes

- Updated dependencies [ea583e6]
  - @x2zod/core@0.6.0

## 0.4.0

### Minor Changes

- 8677011: Add a typed generated helper for deep JSON array-item uniqueness.

  Support `uniqueItems` on non-tuple JSON Schema arrays while preserving accepted values. Tuple and
  prefix-item uniqueness remain unsupported.

### Patch Changes

- Updated dependencies [8677011]
  - @x2zod/core@0.5.0

## 0.3.0

### Minor Changes

- 286c6ea: Add typed, deduplicated generated refinements for exact numeric and Unicode string
  constraints.

  Preserve type-specific keyword applicability without explicit types, support exact `multipleOf`,
  count string lengths by Unicode code point, and lower composite `const` and `enum` values into
  exact tuples and strict objects while preserving special own object keys such as `__proto__`.

### Patch Changes

- Updated dependencies [286c6ea]
  - @x2zod/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [90f1136]
  - @x2zod/core@0.3.0

## 0.2.0

### Minor Changes

- 21b996e: Add public Zod exclusive-union emission support in core.

  Extend JSON Schema lowering with exact `oneOf`, representable sibling assertions, bounded
  `unevaluatedProperties` object composition, validation-inert recognition of `deprecated`,
  `readOnly`, and `writeOnly`, and a pinned Mise `v2026.7.5` acceptance corpus.

### Patch Changes

- Updated dependencies [21b996e]
- Updated dependencies [ceef406]
  - @x2zod/core@0.2.0

## 0.1.3

### Patch Changes

- fcd1d96: Recover release versions for package payload changes and new publishable plugin packages.

## 0.1.2

### Patch Changes

- Patch release to verify GitHub Actions publishing.
- Updated dependencies
  - @x2zod/core@0.1.2

## 0.1.1

### Patch Changes

- Patch release after initial registry bootstrap.
- Updated dependencies
  - @x2zod/core@0.1.1

## 0.0.1

### Patch Changes

- Publish the first post-bootstrap patch release.
- Updated dependencies
  - @x2zod/core@0.0.1
