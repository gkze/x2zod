export {
  ZodCLIOptionSchemaError,
  assertSupportedZodCLIOptionSchema,
  withCLI,
  zodObjectToOptique,
  zodObjectToOptiqueOverrides,
} from "@x2zod/config/zod-to-optique";
export type { ZodCLIOptionMetadata } from "@x2zod/config/zod-to-optique";
export {
  mergeZodCLIOptionOverrides,
  resolveZodCLIOptionOverrides,
} from "@x2zod/config/zod-cli-option-overrides";
export type {
  MergeZodCLIOptionOverridesRequest,
  ZodCLIOptionTransformContext,
} from "@x2zod/config/zod-cli-option-overrides";
