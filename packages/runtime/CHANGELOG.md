# @x2zod/runtime

## 0.2.0

### Minor Changes

- 167137d: Add opt-in shared runtime output through the library, config, and CLI. Keep inline output
  as the default, and share generic helpers and JSON Schema evaluation machinery through the new
  runtime package while preserving schema-specific validation, inferred types, and declaration
  emission.
