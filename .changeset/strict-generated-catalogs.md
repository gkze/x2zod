---
"@x2zod/core": patch
"@x2zod/input-json-schema": patch
---

Fix generated catalogs under strict unused-binding checks by omitting private shared-helper imports
and unused Ajv bindings. Evaluate wide compositions through resource descriptors to avoid oversized
TypeScript control-flow bodies while preserving runtime validation and inferred types. Regenerate
output after upgrading; the shared runtime ABI is unchanged.
