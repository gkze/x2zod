# @x2zod/config

## 0.2.0

### Minor Changes

- 90f1136: Add ordered, schema-language-agnostic emission transforms to library compilation and reusable
  targets.

  Introduce a generic property-mapping transform that emits bidirectional Zod codecs, decodes declared
  snake_case keys as camelCase, rejects compile-time and runtime key collisions, and encodes values
  back to their original wire keys.

### Patch Changes

- Updated dependencies [90f1136]
  - @x2zod/core@0.3.0

## 0.1.4

### Patch Changes

- ceef406: Harden public readonly contracts, dependency declarations, and shared TypeScript compiler
  policy.
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
