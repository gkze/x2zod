---
"@x2zod/core": minor
"@x2zod/config": minor
"@x2zod/cli": minor
"@x2zod/input-json-schema": minor
"@x2zod/runtime": minor
---

Add opt-in shared runtime output through the library, config, and CLI. Keep inline output as the
default, and share generic helpers and JSON Schema evaluation machinery through the new runtime
package while preserving schema-specific validation, inferred types, and declaration emission.
