---
"@x2zod/config": minor
"@x2zod/cli": minor
---

Generalize code-quality-specific plugins behind a reusable output processor contract. This is a
breaking public API rename for the pre-1.0 config and CLI packages. Migrate these APIs:

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
