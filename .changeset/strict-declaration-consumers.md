---
"@x2zod/core": patch
"@x2zod/runtime": patch
"@x2zod/input-json-schema": patch
---

Preserve named generic helper return types so emitted declarations retain valid typed catchall
intersections with optional own prototype keys. Verify strict consumers of both generated source and
declarations, including inline/shared runtime output and transformed catchall values.

Infer encoded runtime guard inputs directly from their structural schema, preserving codec input
types instead of widening them to unknown. Regenerate inline output after upgrading; shared output
also needs the updated runtime package for its corrected public types.

Keep synthetic prototype validation slots distinct from declared properties during key transforms.
Dynamic catchall keys retain their spelling while nested values transform in both directions;
explicitly declared prototype keys continue to follow the requested mapping.

Preserve named value boundaries for finite custom-schema reference chains so TypeScript declaration
emission does not silently elide deep types. Route explicit prototype property maps through the
existing resource evaluator because standalone Ajv filters those names.
