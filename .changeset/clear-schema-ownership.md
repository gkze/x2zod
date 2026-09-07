---
"@x2zod/config": patch
"@x2zod/core": patch
"@x2zod/input-json-schema": patch
---

Keep CLI option registration and parser construction free of default evaluation, reuse prepared JSON
Schema resource state during lowering, and derive Zod operation signatures from the same
specifications as runtime validation.
