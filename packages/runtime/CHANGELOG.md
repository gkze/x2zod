# @x2zod/runtime

## 0.2.1

### Patch Changes

- 015522a: Preserve named generic helper return types so emitted declarations retain valid typed
  catchall intersections with optional own prototype keys. Verify strict consumers of both generated
  source and declarations, including inline/shared runtime output and transformed catchall values.

  Infer encoded runtime guard inputs directly from their structural schema, preserving codec input
  types instead of widening them to unknown. Regenerate inline output after upgrading; shared output
  also needs the updated runtime package for its corrected public types.

  Keep synthetic prototype validation slots distinct from declared properties during key transforms.
  Dynamic catchall keys retain their spelling while nested values transform in both directions;
  explicitly declared prototype keys continue to follow the requested mapping.

  Preserve named value boundaries for finite custom-schema reference chains so TypeScript
  declaration emission does not silently elide deep types. Route explicit prototype property maps
  through the existing resource evaluator because standalone Ajv filters those names.

## 0.2.0

### Minor Changes

- 167137d: Add opt-in shared runtime output through the library, config, and CLI. Keep inline output
  as the default, and share generic helpers and JSON Schema evaluation machinery through the new
  runtime package while preserving schema-specific validation, inferred types, and declaration
  emission.
