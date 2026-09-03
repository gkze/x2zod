# @x2zod/config

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
