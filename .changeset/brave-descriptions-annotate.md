---
"@x2zod/core": minor
---

Add `.describe(...)` support to the Zod emission plan. Plugins can now project string-valued
annotations onto generated schema declarations through the existing planned-call pipeline,
preserving method validation, receiver checks, and transform composition.
