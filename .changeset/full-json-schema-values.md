---
"@x2zod/core": minor
"@x2zod/input-json-schema": minor
---

Add typed, deduplicated generated refinements for exact numeric and Unicode string constraints.

Preserve type-specific keyword applicability without explicit types, support exact `multipleOf`,
count string lengths by Unicode code point, and lower composite `const` and `enum` values into exact
tuples and strict objects while preserving special own object keys such as `__proto__`.
