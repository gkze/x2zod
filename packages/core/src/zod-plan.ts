import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";

export type ZodFactoryName = "boolean" | "never" | "number" | "string" | "unknown";
export type ZodExpression = Readonly<{ kind: "factory"; factory: ZodFactoryName }>;
export type ZodExpressionInput = ZodExpression;
export type ZodEmissionModule = Readonly<{ root: ZodExpression }>;
export type ZodEmissionModuleInput = Readonly<{ root: ZodExpressionInput }>;

const zodFactoryNameSchemaValue: z.ZodType<ZodFactoryName, ZodFactoryName> = z.enum([
  "boolean",
  "never",
  "number",
  "string",
  "unknown",
]);
export const zodFactoryNameSchema: z.ZodType<ZodFactoryName, ZodFactoryName> =
  zodFactoryNameSchemaValue;

const zodExpressionSchemaValue: z.ZodType<ZodExpression, ZodExpressionInput> = z
  .strictObject({ kind: z.literal("factory"), factory: zodFactoryNameSchemaValue })
  .readonly();
export const zodExpressionSchema: z.ZodType<ZodExpression, ZodExpressionInput> =
  zodExpressionSchemaValue;

const zodEmissionModuleSchemaValue: z.ZodType<ZodEmissionModule, ZodEmissionModuleInput> = z
  .strictObject({ root: zodExpressionSchemaValue })
  .readonly();
export const zodEmissionModuleSchema: z.ZodType<ZodEmissionModule, ZodEmissionModuleInput> =
  zodEmissionModuleSchemaValue;

export const zodFactory = (factory: ZodFactoryName): ZodExpression => ({
  factory,
  kind: "factory",
});

export const parseZodEmissionModule = (
  module: ZodEmissionModuleInput,
): Result<ZodEmissionModule> => {
  const parsed = zodEmissionModuleSchemaValue.safeParse(module);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: "invalid_zod_emission_module",
          message: `Zod emission module is invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};
