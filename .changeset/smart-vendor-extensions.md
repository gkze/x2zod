---
"@x2zod/cli": minor
"@x2zod/config": minor
"@x2zod/input-json-schema": minor
---

Accept unknown vendor keywords with warnings by default and preserve opaque source annotations.

This changes the previous strict default. Set `unknownKeywords: "reject"` or
`--unknown-keywords reject` to retain it; `ignore` accepts silently. Exact typed inert rules and
source-profile rules take precedence. The generic policy rejects cross-dialect standard keywords and
unknown `$` names. OpenCode declaration-container compatibility and model repairs remain intact.

Inert keyword kinds now include `array` and `object`. The plugin factory's `projectAnnotations` hook
receives immutable annotations with resource/document locations and returns validated
`{ description?: string }` metadata. It cannot add validation operations. Built-in description
projection is opt-in via `annotationKeywords: { description: true }` or
`--annotation-keywords description=true`. Boolean-map CLI values are parsed without coercion.

Descriptions stay attached to reference sites, targets, composition nodes, and runtime-guarded
exports. Draft 7 reference siblings remain ignored. General instance annotation collection and
additional metadata projections are outside this release.

Allow authentic bundled meta-schema documents to compile from local root or external locations while
rejecting conflicting content under reserved identifiers. Register runtime resources by canonical
identity to avoid duplicate meta-schema registration. Emit large runtime descriptor tables as tuple
literals to keep strict declaration emission within TypeScript's type-complexity limits.

Verify full pinned SchemaStore package.json/Cargo reference closures, generated Draft 7 meta-schema
validation, and Bun workspace/catalog consumption using the provisioned toolchain.
