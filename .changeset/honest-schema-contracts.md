---
"@x2zod/core": patch
"@x2zod/input-json-schema": patch
"@x2zod/config": patch
"@x2zod/cli": patch
"@x2zod/build-inputs": patch
"@x2zod/eslint-plugins": patch
---

Preserve nested codec transformations and recursive optional types, avoid generated utility type
collisions, accept empty property names, and reject unsupported record keys before source emission.
Give exported JSON Schema references their complete validation contract and preserve pattern-matched
required properties and contradictory bounds without reducing JSON Schema conformance.

Parse plugin options once per input transition, keep lint autofixes safe around automatic semicolon
insertion and function hoisting, and make shared build inputs and installed formatter resolution
consistent.
