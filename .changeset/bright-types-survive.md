---
"@x2zod/input-json-schema": patch
"@x2zod/core": patch
---

Preserve structural inference when exact runtime validation is required. Nested property-name
constraints, recoverable composition boundaries, and meta-schema references no longer erase whole
declarations to unknown. Retain recursive meta-schema types and merge object-only allOf shapes with
resource-scoped references; balance remaining intersections to reduce TypeScript instantiation
depth. Runtime predicates continue to enforce the complete source schema without changing parsed
values.

Add compile-time consumer and runtime regression coverage, including full SchemaStore package.json
with Bun catalogs and the Draft 7 meta-schema.

Export recursive type aliases so downstream inferred parse results can emit declarations.
