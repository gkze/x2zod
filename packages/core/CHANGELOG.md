# @x2zod/core

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
