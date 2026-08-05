import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";

export type ZodPropertyKeyCase = "camelCase";
export type ZodCasePropertyKeyTransform = Readonly<{
  decodedCase: ZodPropertyKeyCase;
  kind: "case";
}>;
export type ZodMapPropertiesTransform = Readonly<{
  kind: "map-properties";
  options: Readonly<{ keys: ZodCasePropertyKeyTransform }>;
}>;
export type ZodEmissionTransform = ZodMapPropertiesTransform;
export type ZodEmissionTransformInput = ZodEmissionTransform;

const propertyKeyCaseSchemaValue: z.ZodType<ZodPropertyKeyCase, ZodPropertyKeyCase> =
  z.literal("camelCase");
export const propertyKeyCaseSchema: z.ZodType<ZodPropertyKeyCase, ZodPropertyKeyCase> =
  propertyKeyCaseSchemaValue;

const casePropertyKeyTransformSchemaValue: z.ZodType<
  ZodCasePropertyKeyTransform,
  ZodCasePropertyKeyTransform
> = z.strictObject({ decodedCase: propertyKeyCaseSchemaValue, kind: z.literal("case") }).readonly();
export const casePropertyKeyTransformSchema: z.ZodType<
  ZodCasePropertyKeyTransform,
  ZodCasePropertyKeyTransform
> = casePropertyKeyTransformSchemaValue;

const mapPropertiesTransformSchemaValue: z.ZodType<
  ZodMapPropertiesTransform,
  ZodMapPropertiesTransform
> = z
  .strictObject({
    kind: z.literal("map-properties"),
    options: z.strictObject({ keys: casePropertyKeyTransformSchemaValue }).readonly(),
  })
  .readonly();
export const mapPropertiesTransformSchema: z.ZodType<
  ZodMapPropertiesTransform,
  ZodMapPropertiesTransform
> = mapPropertiesTransformSchemaValue;

const zodEmissionTransformSchemaValue: z.ZodType<ZodEmissionTransform, ZodEmissionTransformInput> =
  mapPropertiesTransformSchemaValue;
export const zodEmissionTransformSchema: z.ZodType<
  ZodEmissionTransform,
  ZodEmissionTransformInput
> = zodEmissionTransformSchemaValue;

const zodEmissionTransformsSchemaValue: z.ZodType<
  readonly ZodEmissionTransform[],
  readonly ZodEmissionTransformInput[]
> = z.array(zodEmissionTransformSchemaValue).readonly();
export const zodEmissionTransformsSchema: z.ZodType<
  readonly ZodEmissionTransform[],
  readonly ZodEmissionTransformInput[]
> = zodEmissionTransformsSchemaValue;

export const resolveZodEmissionTransforms = (
  transforms: readonly ZodEmissionTransformInput[] = [],
): Result<readonly ZodEmissionTransform[]> => {
  const parsed = zodEmissionTransformsSchemaValue.safeParse(transforms);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: "invalid_emission_transforms",
          message: `Emission transforms are invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};
