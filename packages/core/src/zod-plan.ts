import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err } from "./result";
import type { Result } from "./result";
import { validateZodEmissionModule } from "./zod-plan-validation";

const nonEmptyStringLength = 1;

export type ZodFactoryName =
  | "array"
  | "boolean"
  | "literal"
  | "never"
  | "null"
  | "number"
  | "object"
  | "string"
  | "union"
  | "unknown";
export type ZodLiteralValue = boolean | null | number | string;
export type ZodSymbol = string & z.$brand<"ZodSymbol">;
export type ZodMethodName = string & z.$brand<"ZodMethodName">;
export type ZodDeclarationNameHintProvenance =
  | "anchor"
  | "definitionKey"
  | "explicit"
  | "pointer"
  | "title"
  | "uriSegment";

export type ZodMethodCall = Readonly<{ method: ZodMethodName; args: readonly ZodArgument[] }>;
export type ZodMethodCallInput = Readonly<{
  method: string;
  args?: readonly ZodArgumentInput[] | undefined;
}>;

export type ZodObjectProperty = Readonly<{ key: string; expression: ZodExpression }>;
export type ZodObjectPropertyInput = Readonly<{ key: string; expression: ZodExpressionInput }>;

export type ZodArgument =
  | Readonly<{ kind: "array"; elements: readonly ZodArgument[] }>
  | Readonly<{ kind: "expression"; expression: ZodExpression }>
  | Readonly<{ kind: "literal"; value: ZodLiteralValue }>
  | Readonly<{ kind: "object"; properties: readonly ZodObjectProperty[] }>;
export type ZodArgumentInput =
  | Readonly<{ kind: "array"; elements: readonly ZodArgumentInput[] }>
  | Readonly<{ kind: "expression"; expression: ZodExpressionInput }>
  | Readonly<{ kind: "literal"; value: ZodLiteralValue }>
  | Readonly<{ kind: "object"; properties: readonly ZodObjectPropertyInput[] }>;

export type ZodFactoryExpression = Readonly<{
  kind: "factory";
  factory: ZodFactoryName;
  args: readonly ZodArgument[];
  calls: readonly ZodMethodCall[];
}>;
export type ZodFactoryExpressionInput = Readonly<{
  kind: "factory";
  factory: ZodFactoryName;
  args?: readonly ZodArgumentInput[] | undefined;
  calls?: readonly ZodMethodCallInput[] | undefined;
}>;
export type ZodReferenceExpression = Readonly<{
  kind: "reference";
  symbol: ZodSymbol;
  calls: readonly ZodMethodCall[];
}>;
export type ZodReferenceExpressionInput = Readonly<{
  kind: "reference";
  symbol: string;
  calls?: readonly ZodMethodCallInput[] | undefined;
}>;
export type ZodExpression = ZodFactoryExpression | ZodReferenceExpression;
export type ZodExpressionInput = ZodFactoryExpressionInput | ZodReferenceExpressionInput;

export type ZodDeclarationNameHint = Readonly<{
  value: string;
  provenance: ZodDeclarationNameHintProvenance;
}>;
export type ZodDeclarationNameHintInput = Readonly<{
  value: string;
  provenance?: ZodDeclarationNameHintProvenance | undefined;
}>;
export type ZodDeclaration = Readonly<{
  symbol: ZodSymbol;
  expression: ZodExpression;
  nameHints: readonly ZodDeclarationNameHint[];
}>;
export type ZodDeclarationInput = Readonly<{
  symbol: string;
  expression: ZodExpressionInput;
  nameHints?: readonly ZodDeclarationNameHintInput[] | undefined;
}>;
export type ZodEmissionModule = Readonly<{
  root: ZodSymbol;
  declarations: readonly ZodDeclaration[];
}>;
export type ZodEmissionModuleInput = Readonly<{
  root: string;
  declarations: readonly ZodDeclarationInput[];
}>;

const zodSymbolSchemaValue: z.ZodType<ZodSymbol, string> = z
  .string()
  .min(nonEmptyStringLength)
  .transform((value): ZodSymbol => value as ZodSymbol);
export const zodSymbolSchema: z.ZodType<ZodSymbol, string> = zodSymbolSchemaValue;

const zodMethodNameSchemaValue: z.ZodType<ZodMethodName, string> = z
  .string()
  .regex(/^[A-Za-z_$][\w$]*$/u)
  .transform((value): ZodMethodName => value as ZodMethodName);
export const zodMethodNameSchema: z.ZodType<ZodMethodName, string> = zodMethodNameSchemaValue;

const zodFactoryNameSchemaValue: z.ZodType<ZodFactoryName, ZodFactoryName> = z.enum([
  "array",
  "boolean",
  "literal",
  "never",
  "null",
  "number",
  "object",
  "string",
  "union",
  "unknown",
]);
export const zodFactoryNameSchema: z.ZodType<ZodFactoryName, ZodFactoryName> =
  zodFactoryNameSchemaValue;

const zodLiteralValueSchemaValue: z.ZodType<ZodLiteralValue, ZodLiteralValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const zodLiteralValueSchema: z.ZodType<ZodLiteralValue, ZodLiteralValue> =
  zodLiteralValueSchemaValue;

const zodArgumentSchemaValue: z.ZodType<ZodArgument, ZodArgumentInput> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .strictObject({
        kind: z.literal("array"),
        elements: z.array(zodArgumentSchemaValue).readonly(),
      })
      .readonly(),
    z
      .strictObject({ kind: z.literal("expression"), expression: zodExpressionSchemaValue })
      .readonly(),
    z.strictObject({ kind: z.literal("literal"), value: zodLiteralValueSchemaValue }).readonly(),
    z
      .strictObject({
        kind: z.literal("object"),
        properties: z.array(zodObjectPropertySchemaValue).readonly(),
      })
      .readonly(),
  ]),
);
export const zodArgumentSchema: z.ZodType<ZodArgument, ZodArgumentInput> = zodArgumentSchemaValue;

const zodMethodCallSchemaValue: z.ZodType<ZodMethodCall, ZodMethodCallInput> = z
  .strictObject({
    method: zodMethodNameSchemaValue,
    args: z.array(zodArgumentSchemaValue).readonly().default([]),
  })
  .readonly();
export const zodMethodCallSchema: z.ZodType<ZodMethodCall, ZodMethodCallInput> =
  zodMethodCallSchemaValue;

const zodObjectPropertySchemaValue: z.ZodType<ZodObjectProperty, ZodObjectPropertyInput> = z.lazy(
  () =>
    z
      .strictObject({
        key: z.string().min(nonEmptyStringLength),
        expression: zodExpressionSchemaValue,
      })
      .readonly(),
);
export const zodObjectPropertySchema: z.ZodType<ZodObjectProperty, ZodObjectPropertyInput> =
  zodObjectPropertySchemaValue;

const zodExpressionSchemaValue: z.ZodType<ZodExpression, ZodExpressionInput> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .strictObject({
        kind: z.literal("factory"),
        factory: zodFactoryNameSchemaValue,
        args: z.array(zodArgumentSchemaValue).readonly().default([]),
        calls: z.array(zodMethodCallSchemaValue).readonly().default([]),
      })
      .readonly(),
    z
      .strictObject({
        kind: z.literal("reference"),
        symbol: zodSymbolSchemaValue,
        calls: z.array(zodMethodCallSchemaValue).readonly().default([]),
      })
      .readonly(),
  ]),
);
export const zodExpressionSchema: z.ZodType<ZodExpression, ZodExpressionInput> =
  zodExpressionSchemaValue;

const zodDeclarationNameHintProvenanceSchemaValue: z.ZodType<
  ZodDeclarationNameHintProvenance,
  ZodDeclarationNameHintProvenance
> = z.enum(["anchor", "definitionKey", "explicit", "pointer", "title", "uriSegment"]);
export const zodDeclarationNameHintProvenanceSchema: z.ZodType<
  ZodDeclarationNameHintProvenance,
  ZodDeclarationNameHintProvenance
> = zodDeclarationNameHintProvenanceSchemaValue;

const zodDeclarationNameHintSchemaValue: z.ZodType<
  ZodDeclarationNameHint,
  ZodDeclarationNameHintInput
> = z
  .strictObject({
    value: z.string().min(nonEmptyStringLength),
    provenance: zodDeclarationNameHintProvenanceSchemaValue.default("explicit"),
  })
  .readonly();
export const zodDeclarationNameHintSchema: z.ZodType<
  ZodDeclarationNameHint,
  ZodDeclarationNameHintInput
> = zodDeclarationNameHintSchemaValue;

const zodDeclarationSchemaValue: z.ZodType<ZodDeclaration, ZodDeclarationInput> = z
  .strictObject({
    symbol: zodSymbolSchemaValue,
    expression: zodExpressionSchemaValue,
    nameHints: z.array(zodDeclarationNameHintSchemaValue).readonly().default([]),
  })
  .readonly();
export const zodDeclarationSchema: z.ZodType<ZodDeclaration, ZodDeclarationInput> =
  zodDeclarationSchemaValue;

const zodEmissionModuleSchemaValue: z.ZodType<ZodEmissionModule, ZodEmissionModuleInput> = z
  .strictObject({
    root: zodSymbolSchemaValue,
    declarations: z.array(zodDeclarationSchemaValue).readonly(),
  })
  .readonly();
export const zodEmissionModuleSchema: z.ZodType<ZodEmissionModule, ZodEmissionModuleInput> =
  zodEmissionModuleSchemaValue;

export const zodSymbol = (value: string): ZodSymbol => zodSymbolSchemaValue.parse(value);

export const zodExpressionArgument = (expression: ZodExpression): ZodArgument => ({
  expression,
  kind: "expression",
});

export const zodLiteralArgument = (value: ZodLiteralValue): ZodArgument => ({
  kind: "literal",
  value,
});

export const zodArrayArgument = (elements: readonly ZodArgument[]): ZodArgument => ({
  elements,
  kind: "array",
});

export const zodObjectShapeArgument = (
  properties: Readonly<Record<string, ZodExpression>>,
): ZodArgument => ({
  kind: "object",
  properties: Object.entries(properties).map(([key, expression]) => ({ expression, key })),
});

export const zodCall = (
  expression: ZodExpression,
  method: string,
  args: readonly ZodArgument[] = [],
): ZodExpression => ({
  ...expression,
  calls: [...expression.calls, { args, method: zodMethodNameSchemaValue.parse(method) }],
});

export const zodFactory = (
  factory: ZodFactoryName,
  args: readonly ZodArgument[] = [],
  calls: readonly ZodMethodCall[] = [],
): ZodExpression => ({ args, calls, factory, kind: "factory" });

export const zodReference = (symbol: ZodSymbol): ZodExpression => ({
  calls: [],
  kind: "reference",
  symbol,
});

export const zodDeclarationNameHint = (
  value: string,
  provenance: ZodDeclarationNameHintProvenance = "explicit",
): ZodDeclarationNameHint => ({ provenance, value });

export const zodDeclaration = (
  symbol: ZodSymbol,
  expression: ZodExpression,
  nameHints: readonly ZodDeclarationNameHint[] = [],
): ZodDeclaration => ({ expression, nameHints, symbol });

export const zodModule = (
  root: ZodSymbol,
  declarations: readonly ZodDeclaration[],
): ZodEmissionModule => ({ declarations, root });

export const zodPlan = {
  array: (element: ZodExpression): ZodExpression =>
    zodFactory("array", [zodExpressionArgument(element)]),
  boolean: (): ZodExpression => zodFactory("boolean"),
  literal: (value: ZodLiteralValue): ZodExpression =>
    zodFactory("literal", [zodLiteralArgument(value)]),
  never: (): ZodExpression => zodFactory("never"),
  null: (): ZodExpression => zodFactory("null"),
  nullable: (expression: ZodExpression): ZodExpression => zodCall(expression, "nullable"),
  number: (): ZodExpression => zodFactory("number"),
  object: (properties: Readonly<Record<string, ZodExpression>>): ZodExpression =>
    zodFactory("object", [zodObjectShapeArgument(properties)]),
  optional: (expression: ZodExpression): ZodExpression => zodCall(expression, "optional"),
  reference: (symbol: ZodSymbol): ZodExpression => zodReference(symbol),
  string: (): ZodExpression => zodFactory("string"),
  union: (options: readonly [ZodExpression, ZodExpression, ...ZodExpression[]]): ZodExpression =>
    zodFactory("union", [zodArrayArgument(options.map((option) => zodExpressionArgument(option)))]),
  unknown: (): ZodExpression => zodFactory("unknown"),
} as const;

export const parseZodEmissionModule = (
  module: ZodEmissionModuleInput,
): Result<ZodEmissionModule> => {
  const parsed = zodEmissionModuleSchemaValue.safeParse(module);
  if (!parsed.success)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module is invalid: ${formatZodError(parsed.error)}`,
      }),
    );

  return validateZodEmissionModule(parsed.data);
};
