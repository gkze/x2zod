---
"@x2zod/input-json-schema": patch
---

Index unused-binding diagnostic ranges during generated runtime cleanup to avoid repeated linear
scans in large schemas. Preserve nested diagnostic containment and generated validation behavior.
