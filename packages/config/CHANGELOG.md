# @x2zod/config

## 0.7.1

### Patch Changes

- Updated dependencies [271a147]
- Updated dependencies [7370ecb]
  - @x2zod/core@0.8.1

## 0.7.0

### Minor Changes

- 167137d: Add opt-in shared runtime output through the library, config, and CLI. Keep inline output
  as the default, and share generic helpers and JSON Schema evaluation machinery through the new
  runtime package while preserving schema-specific validation, inferred types, and declaration
  emission.

### Patch Changes

- 167137d: Keep CLI option registration and parser construction free of default evaluation, reuse
  prepared JSON Schema resource state during lowering, and derive Zod operation signatures from the
  same specifications as runtime validation.
- Updated dependencies [167137d]
- Updated dependencies [167137d]
  - @x2zod/core@0.8.0

## 0.6.1

### Patch Changes

- Updated dependencies [005c01f]
  - @x2zod/core@0.7.1

## 0.6.0

### Minor Changes

- 7b25c88: Accept unknown vendor keywords with warnings by default and preserve opaque source
  annotations.

  This changes the previous strict default. Set `unknownKeywords: "reject"` or
  `--unknown-keywords reject` to retain it; `ignore` accepts silently. Exact typed inert rules and
  source-profile rules take precedence. The generic policy rejects cross-dialect standard keywords
  and unknown `$` names. OpenCode declaration-container compatibility and model repairs remain
  intact.

  Inert keyword kinds now include `array` and `object`. The plugin factory's `projectAnnotations`
  hook receives immutable annotations with resource/document locations and returns validated
  `{ description?: string }` metadata. It cannot add validation operations. Built-in description
  projection is opt-in via `annotationKeywords: { description: true }` or
  `--annotation-keywords description=true`. Boolean-map CLI values are parsed without coercion.

  Descriptions stay attached to reference sites, targets, composition nodes, and runtime-guarded
  exports. Draft 7 reference siblings remain ignored. General instance annotation collection and
  additional metadata projections are outside this release.

  Allow authentic bundled meta-schema documents to compile from local root or external locations
  while rejecting conflicting content under reserved identifiers. Register runtime resources by
  canonical identity to avoid duplicate meta-schema registration. Emit large runtime descriptor
  tables as tuple literals to keep strict declaration emission within TypeScript's type-complexity
  limits.

  Verify full pinned SchemaStore package.json/Cargo reference closures, generated Draft 7
  meta-schema validation, and Bun workspace/catalog consumption using the provisioned toolchain.

### Patch Changes

- Updated dependencies [7b25c88]
  - @x2zod/core@0.7.0

## 0.5.1

### Patch Changes

- 0e8c3e2: Preserve nested codec transformations and recursive optional types, avoid generated
  utility type collisions, accept empty property names, and reject unsupported record keys before
  source emission. Give exported JSON Schema references their complete validation contract and
  preserve pattern-matched required properties and contradictory bounds without reducing JSON Schema
  conformance.

  Parse plugin options once per input transition, keep lint autofixes safe around automatic
  semicolon insertion and function hoisting, and make shared build inputs and installed formatter
  resolution consistent.

- Updated dependencies [0e8c3e2]
  - @x2zod/core@0.6.1

## 0.5.0

### Minor Changes

- 7569ff8: Add configurable, primitive-typed inert JSON Schema keywords. Accept exact custom keyword
  names through plugin configuration or repeatable `--inert-keyword NAME=TYPE` CLI flags, preserve
  strict unknown-keyword diagnostics by default, and ignore validated metadata without changing
  generated validation semantics.

## 0.4.0

### Minor Changes

- ea583e6: Add deterministic runtime-program emission, stable declaration configuration,
  host-provided document retrieval URIs, and full pinned required-suite support for JSON Schema
  Draft 7, Draft 2019-09, and Draft 2020-12. Add a strict SchemaStore compatibility profile for its
  inert `tsType` and `x-intellij-language-injection` annotations.

### Patch Changes

- Updated dependencies [ea583e6]
  - @x2zod/core@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [8677011]
  - @x2zod/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [286c6ea]
  - @x2zod/core@0.4.0

## 0.3.0

### Minor Changes

- 3d9332e: Generalize code-quality-specific plugins behind a reusable output processor contract.
  This is a breaking public API rename for the pre-1.0 config and CLI packages. Migrate these APIs:

  | Previous API                              | Replacement                             |
  | ----------------------------------------- | --------------------------------------- |
  | `plugins.codeQuality`                     | `plugins.output`                        |
  | `output.codeQuality`                      | `output.processors`                     |
  | `applyX2ZodCodeQuality`                   | `applyX2ZodOutputProcessors`            |
  | `ApplyX2ZodCodeQualityRequest`            | `ApplyX2ZodOutputProcessorsRequest`     |
  | `X2ZodAnyCodeQualityPlugin`               | `X2ZodAnyOutputProcessorPlugin`         |
  | `X2ZodCodeQualityContext`                 | `X2ZodOutputProcessorContext`           |
  | `X2ZodCodeQualityKey`                     | `X2ZodOutputProcessorKey`               |
  | `X2ZodCodeQualityPlugin`                  | `X2ZodOutputProcessorPlugin`            |
  | `X2ZodCodeQualityRegistry`                | `X2ZodOutputProcessorRegistry`          |
  | `X2ZodCodeQualityRegistryFor`             | `X2ZodOutputProcessorRegistryFor`       |
  | `X2ZodEmptyCodeQualityRegistry`           | `X2ZodEmptyOutputProcessorRegistry`     |
  | `X2ZodLoadedCodeQualityPlugin`            | `X2ZodLoadedOutputProcessorPlugin`      |
  | `X2ZodLoadedCodeQualityRegistry`          | `X2ZodLoadedOutputProcessorRegistry`    |
  | `X2ZodOutputCodeQualityConfig`            | `X2ZodOutputProcessorConfig`            |
  | `X2ZodOutputCodeQualityConfigFor`         | `X2ZodOutputProcessorConfigFor`         |
  | `X2ZodResolvedOutputCodeQualityConfig`    | `X2ZodResolvedOutputProcessorConfig`    |
  | `X2ZodResolvedOutputCodeQualityConfigFor` | `X2ZodResolvedOutputProcessorConfigFor` |

  The concrete Oxfmt and Oxlint package and export names, along with code-quality tool configuration
  helpers such as `X2ZodCodeQualityToolConfig`, remain unchanged.

## 0.2.0

### Minor Changes

- 90f1136: Add ordered, schema-language-agnostic emission transforms to library compilation and
  reusable targets.

  Introduce a generic property-mapping transform that emits bidirectional Zod codecs, decodes
  declared snake_case keys as camelCase, rejects compile-time and runtime key collisions, and
  encodes values back to their original wire keys.

### Patch Changes

- Updated dependencies [90f1136]
  - @x2zod/core@0.3.0

## 0.1.4

### Patch Changes

- ceef406: Harden public readonly contracts, dependency declarations, and shared TypeScript compiler
  policy.
- Updated dependencies [21b996e]
- Updated dependencies [ceef406]
  - @x2zod/core@0.2.0

## 0.1.3

### Patch Changes

- fcd1d96: Recover release versions for package payload changes and new publishable plugin packages.

## 0.1.2

### Patch Changes

- Patch release to verify GitHub Actions publishing.
- Updated dependencies
  - @x2zod/core@0.1.2

## 0.1.1

### Patch Changes

- Patch release after initial registry bootstrap.
- Updated dependencies
  - @x2zod/core@0.1.1
