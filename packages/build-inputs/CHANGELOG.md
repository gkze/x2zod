# @x2zod/build-inputs

## 0.2.1

### Patch Changes

- 0e8c3e2: Preserve nested codec transformations and recursive optional types, avoid generated
  utility type collisions, accept empty property names, and reject unsupported record keys before
  source emission. Give exported JSON Schema references their complete validation contract and
  preserve pattern-matched required properties and contradictory bounds without reducing JSON Schema
  conformance.

  Parse plugin options once per input transition, keep lint autofixes safe around automatic
  semicolon insertion and function hoisting, and make shared build inputs and installed formatter
  resolution consistent.

## 0.2.0

### Minor Changes

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
