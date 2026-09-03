---
"@x2zod/cli": minor
"@x2zod/config": minor
"@x2zod/input-json-schema": minor
---

Add configurable, primitive-typed inert JSON Schema keywords. Accept exact custom keyword names
through plugin configuration or repeatable `--inert-keyword NAME=TYPE` CLI flags, preserve strict
unknown-keyword diagnostics by default, and ignore validated metadata without changing generated
validation semantics.
