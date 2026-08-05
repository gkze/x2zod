---
"@x2zod/config": minor
"@x2zod/core": minor
---

Add ordered, schema-language-agnostic emission transforms to library compilation and reusable
targets.

Introduce a generic property-mapping transform that emits bidirectional Zod codecs, decodes declared
snake_case keys as camelCase, rejects compile-time and runtime key collisions, and encodes values
back to their original wire keys.
