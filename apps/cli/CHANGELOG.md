# @x2zod/cli

## 0.2.1

### Patch Changes

- Updated dependencies [286c6ea]
  - @x2zod/core@0.4.0
  - @x2zod/config@0.3.1

## 0.2.0

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

### Patch Changes

- Updated dependencies [3d9332e]
  - @x2zod/config@0.3.0

## 0.1.5

### Patch Changes

- Updated dependencies [90f1136]
  - @x2zod/config@0.2.0
  - @x2zod/core@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [21b996e]
- Updated dependencies [ceef406]
  - @x2zod/core@0.2.0
  - @x2zod/config@0.1.4

## 0.1.3

### Patch Changes

- fcd1d96: Recover release versions for package payload changes and new publishable plugin packages.
- Updated dependencies [fcd1d96]
  - @x2zod/config@0.1.3

## 0.1.2

### Patch Changes

- Patch release to verify GitHub Actions publishing.
- Updated dependencies
  - @x2zod/config@0.1.2
  - @x2zod/core@0.1.2

## 0.1.1

### Patch Changes

- Patch release after initial registry bootstrap.
- Updated dependencies
  - @x2zod/config@0.1.1
  - @x2zod/core@0.1.1
  - @x2zod/input-json-schema@0.1.1

## 0.0.1

### Patch Changes

- Publish the first post-bootstrap patch release.
- Updated dependencies
  - @x2zod/core@0.0.1
