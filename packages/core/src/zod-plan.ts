import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err } from "./result";
import type { Result } from "./result";
import { zodRuntimeProgramIdSchema, zodRuntimeProgramSchema } from "./runtime-program";
import type { ZodRuntimeProgramId } from "./runtime-program";
import { isTypeScriptIdentifier } from "./typescript-identifiers";
import type {
  ZodDeclaration,
  ZodDeclarationInput,
  ZodDeclarationNameHint,
  ZodDeclarationNameHintInput,
  ZodDeclarationNameHintProvenance,
  ZodEmissionModule,
  ZodEmissionModuleInput,
} from "./zod-declarations";
import { zodHelperRequestSchema, zodWrapperNames } from "./zod-helpers";
import type { ZodHelperRequest, ZodHelperRequestInput, ZodWrapperName } from "./zod-helpers";
import { zodFactoryNames } from "./zod-plan-metadata";
import type {
  ZodFactoryName,
  ZodKnownMethodName,
  ZodNoArgumentFactoryName,
  ZodNoArgumentMethodName,
} from "./zod-plan-metadata";
import type { ZodFactoryArgumentsByName, ZodMethodArgumentsByName } from "./zod-plan-signatures";
import { validateZodEmissionModule } from "./zod-plan-validation";
import { zodRuntimeGuard } from "./zod-runtime-guard";
import type {
  ZodRuntimeGuardExpression,
  ZodRuntimeGuardExpressionInput,
  ZodRuntimeGuardPlacement,
} from "./zod-runtime-guard";

const nonEmptyStringLength = 1;

export {
  isZodKnownMethodName,
  zodFactoryMetadata,
  zodFactoryNames,
  zodKnownMethodNames,
  zodMethodMetadata,
  zodMethodMetadataFor,
} from "./zod-plan-metadata";
export type { ZodFactoryName, ZodKnownMethodName } from "./zod-plan-metadata";
export { zodDeclaration, zodDeclarationNameHint, zodModule } from "./zod-declarations";
export type {
  ZodDeclaration,
  ZodDeclarationInput,
  ZodDeclarationNameHint,
  ZodDeclarationNameHintInput,
  ZodDeclarationNameHintProvenance,
  ZodEmissionModule,
  ZodEmissionModuleInput,
} from "./zod-declarations";
export type { ZodFactoryArgumentsByName, ZodMethodArgumentsByName } from "./zod-plan-signatures";
export { zodRuntimeGuard } from "./zod-runtime-guard";
export type {
  ZodRuntimeGuardExpression,
  ZodRuntimeGuardExpressionInput,
  ZodRuntimeGuardPlacement,
} from "./zod-runtime-guard";
export type ZodLiteralValue = boolean | null | number | string;
export type ZodRegexFlags = Readonly<{
  dotAll?: boolean | undefined;
  global?: boolean | undefined;
  hasIndices?: boolean | undefined;
  ignoreCase?: boolean | undefined;
  multiline?: boolean | undefined;
  sticky?: boolean | undefined;
  unicode?: boolean | undefined;
  unicodeSets?: boolean | undefined;
}>;
export type ZodSymbol = string & z.$brand<"ZodSymbol">;
export type ZodMethodName = ZodKnownMethodName | (string & z.$brand<"ZodMethodName">);
export type ZodMethodCall = Readonly<{ method: ZodMethodName; args: readonly ZodArgument[] }>;
export type ZodMethodCallInput = Readonly<{
  method: string;
  args?: readonly ZodArgumentInput[] | undefined;
}>;

export type ZodObjectProperty = Readonly<{ key: string; expression: ZodExpression }>;
export type ZodObjectPropertyInput = Readonly<{ key: string; expression: ZodExpressionInput }>;

export interface ZodArrayArgument<TElement extends ZodArgument = ZodArgument> {
  readonly elements: readonly TElement[];
  readonly kind: "array";
}
export interface ZodExpressionArgument {
  readonly expression: ZodExpression;
  readonly kind: "expression";
}
export interface ZodLiteralArgument<TValue extends ZodLiteralValue = ZodLiteralValue> {
  readonly kind: "literal";
  readonly value: TValue;
}
export interface ZodHelperArgument {
  readonly kind: "helper";
  readonly request: ZodHelperRequest;
}
export interface ZodObjectShapeArgument {
  readonly kind: "object";
  readonly properties: readonly ZodObjectProperty[];
}
export type ZodArgument =
  | ZodArrayArgument
  | ZodExpressionArgument
  | ZodHelperArgument
  | ZodLiteralArgument
  | ZodObjectShapeArgument;
export type ZodArgumentInput =
  | Readonly<{ kind: "array"; elements: readonly ZodArgumentInput[] }>
  | Readonly<{ kind: "expression"; expression: ZodExpressionInput }>
  | Readonly<{ kind: "helper"; request: ZodHelperRequestInput }>
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
export type ZodWrapperExpression = Readonly<{
  calls: readonly ZodMethodCall[];
  expression: ZodExpression;
  kind: "wrapper";
  requiredOwnKeys: readonly string[];
  wrapper: ZodWrapperName;
}>;
export type ZodWrapperExpressionInput = Readonly<{
  calls?: readonly ZodMethodCallInput[] | undefined;
  expression: ZodExpressionInput;
  kind: "wrapper";
  requiredOwnKeys: readonly string[];
  wrapper: ZodWrapperName;
}>;
export type ZodExpression =
  | ZodFactoryExpression
  | ZodReferenceExpression
  | ZodRuntimeGuardExpression
  | ZodWrapperExpression;
export type ZodExpressionInput =
  | ZodFactoryExpressionInput
  | ZodReferenceExpressionInput
  | ZodRuntimeGuardExpressionInput
  | ZodWrapperExpressionInput;

const zodSymbolSchemaValue: z.ZodType<ZodSymbol, string> = z
  .string()
  .min(nonEmptyStringLength)
  .transform((value): ZodSymbol => value as ZodSymbol);
export const zodSymbolSchema: z.ZodType<ZodSymbol, string> = zodSymbolSchemaValue;

const zodMethodNameSchemaValue: z.ZodType<ZodMethodName, string> = z
  .string()
  .refine(isTypeScriptIdentifier)
  .transform((value): ZodMethodName => value as ZodMethodName);
export const zodMethodNameSchema: z.ZodType<ZodMethodName, string> = zodMethodNameSchemaValue;

const zodFactoryNameSchemaValue: z.ZodType<ZodFactoryName, ZodFactoryName> =
  z.enum(zodFactoryNames);
export const zodFactoryNameSchema: z.ZodType<ZodFactoryName, ZodFactoryName> =
  zodFactoryNameSchemaValue;

const zodWrapperNameSchemaValue: z.ZodType<ZodWrapperName, ZodWrapperName> =
  z.enum(zodWrapperNames);

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
    z.strictObject({ kind: z.literal("helper"), request: zodHelperRequestSchema }).readonly(),
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
    z
      .strictObject({
        calls: z.array(zodMethodCallSchemaValue).readonly().default([]),
        expression: zodExpressionSchemaValue,
        kind: z.literal("runtime-guard"),
        placement: z.literal("encoded-input"),
        program: zodRuntimeProgramIdSchema,
      })
      .readonly(),
    z
      .strictObject({
        calls: z.array(zodMethodCallSchemaValue).readonly().default([]),
        expression: zodExpressionSchemaValue,
        kind: z.literal("wrapper"),
        requiredOwnKeys: z.array(z.string()).readonly(),
        wrapper: zodWrapperNameSchemaValue,
      })
      .readonly(),
  ]),
);
export const zodExpressionSchema: z.ZodType<ZodExpression, ZodExpressionInput> =
  zodExpressionSchemaValue;

const zodDeclarationNameHintProvenanceSchemaValue: z.ZodType<
  ZodDeclarationNameHintProvenance,
  ZodDeclarationNameHintProvenance
> = z.string().min(nonEmptyStringLength);
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
    runtimePrograms: z.array(zodRuntimeProgramSchema).readonly().default([]),
  })
  .readonly();
export const zodEmissionModuleSchema: z.ZodType<ZodEmissionModule, ZodEmissionModuleInput> =
  zodEmissionModuleSchemaValue;

export const zodSymbol = (value: string): ZodSymbol => zodSymbolSchemaValue.parse(value);

export const zodExpressionArgument = (expression: ZodExpression): ZodExpressionArgument => ({
  expression,
  kind: "expression",
});

export const zodLiteralArgument = <TValue extends ZodLiteralValue>(
  value: TValue,
): ZodLiteralArgument<TValue> => ({ kind: "literal", value });

export const zodHelperArgument = (request: ZodHelperRequest): ZodHelperArgument => ({
  kind: "helper",
  request,
});

export const zodArrayArgument = <TElement extends ZodArgument>(
  elements: readonly TElement[],
): ZodArrayArgument<TElement> => ({ elements, kind: "array" });

export const zodObjectShapeArgument = (
  properties: Readonly<Record<string, ZodExpression>>,
): ZodObjectShapeArgument => ({
  kind: "object",
  properties: Object.entries(properties).map(([key, expression]) => ({ expression, key })),
});

const zodRegexFlagsText = (flags: ZodRegexFlags): string =>
  [
    flags.hasIndices === true ? "d" : "",
    flags.global === true ? "g" : "",
    flags.ignoreCase === true ? "i" : "",
    flags.multiline === true ? "m" : "",
    flags.dotAll === true ? "s" : "",
    flags.unicode === true ? "u" : "",
    flags.unicodeSets === true ? "v" : "",
    flags.sticky === true ? "y" : "",
  ].join("");

type ZodMethodBuilderArguments<TMethod extends ZodKnownMethodName> =
  TMethod extends ZodNoArgumentMethodName ? [] : [args: ZodMethodArgumentsByName[TMethod]];

type ZodCallBuilder = <TMethod extends ZodKnownMethodName>(
  expression: ZodExpression,
  method: TMethod,
  ...args: ZodMethodBuilderArguments<TMethod>
) => ZodExpression;

export const zodCall: ZodCallBuilder = (
  expression: ZodExpression,
  method: ZodKnownMethodName,
  ...args: readonly [args?: readonly ZodArgument[]]
): ZodExpression => ({
  ...expression,
  calls: [
    ...expression.calls,
    { args: args[0] ?? [], method: zodMethodNameSchemaValue.parse(method) },
  ],
});

type ZodFactoryBuilderArguments<TFactory extends ZodFactoryName> =
  TFactory extends ZodNoArgumentFactoryName ? [] : [args: ZodFactoryArgumentsByName[TFactory]];

type ZodFactoryBuilder = <TFactory extends ZodFactoryName>(
  factory: TFactory,
  ...args: ZodFactoryBuilderArguments<TFactory>
) => ZodExpression;

export const zodFactory: ZodFactoryBuilder = (
  factory: ZodFactoryName,
  ...args: readonly [args?: readonly ZodArgument[]]
): ZodExpression => ({ args: args[0] ?? [], calls: [], factory, kind: "factory" });

export const zodReference = (symbol: ZodSymbol): ZodExpression => ({
  calls: [],
  kind: "reference",
  symbol,
});

export const zodWrapper = (
  wrapper: ZodWrapperName,
  expression: ZodExpression,
  requiredOwnKeys: readonly string[],
): ZodExpression => ({ calls: [], expression, kind: "wrapper", requiredOwnKeys, wrapper });

export const zodPlan = {
  array: (element: ZodExpression): ZodExpression =>
    zodFactory("array", [zodExpressionArgument(element)]),
  boolean: (): ZodExpression => zodFactory("boolean"),
  catchall: (object: ZodExpression, value: ZodExpression): ZodExpression =>
    zodCall(object, "catchall", [zodExpressionArgument(value)]),
  enum: (values: readonly [string, ...string[]]): ZodExpression =>
    zodFactory("enum", [zodArrayArgument(values.map((value) => zodLiteralArgument(value)))]),
  gt: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "gt", [zodLiteralArgument(value)]),
  gte: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "gte", [zodLiteralArgument(value)]),
  integer: (): ZodExpression => zodCall(zodFactory("number"), "int"),
  literal: (value: ZodLiteralValue): ZodExpression =>
    zodFactory("literal", [zodLiteralArgument(value)]),
  lt: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "lt", [zodLiteralArgument(value)]),
  lte: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "lte", [zodLiteralArgument(value)]),
  max: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "max", [zodLiteralArgument(value)]),
  min: (expression: ZodExpression, value: number): ZodExpression =>
    zodCall(expression, "min", [zodLiteralArgument(value)]),
  never: (): ZodExpression => zodFactory("never"),
  null: (): ZodExpression => zodFactory("null"),
  nullable: (expression: ZodExpression): ZodExpression => zodCall(expression, "nullable"),
  number: (): ZodExpression => zodFactory("number"),
  object: (properties: Readonly<Record<string, ZodExpression>>): ZodExpression =>
    zodFactory("object", [zodObjectShapeArgument(properties)]),
  intersection: (left: ZodExpression, right: ZodExpression): ZodExpression =>
    zodFactory("intersection", [zodExpressionArgument(left), zodExpressionArgument(right)]),
  optional: (expression: ZodExpression): ZodExpression => zodCall(expression, "optional"),
  passthrough: (object: ZodExpression): ZodExpression => zodCall(object, "passthrough"),
  preserveObjectInput: (object: ZodExpression, requiredOwnKeys: readonly string[]): ZodExpression =>
    zodWrapper("preserveObjectInput", object, requiredOwnKeys),
  record: (key: ZodExpression, value: ZodExpression): ZodExpression =>
    zodFactory("record", [zodExpressionArgument(key), zodExpressionArgument(value)]),
  refine: (expression: ZodExpression, request: ZodHelperRequest): ZodExpression =>
    zodCall(expression, "refine", [zodHelperArgument(request)]),
  reference: (symbol: ZodSymbol): ZodExpression => zodReference(symbol),
  regex: (expression: ZodExpression, pattern: string, flags: ZodRegexFlags = {}): ZodExpression =>
    zodCall(expression, "regex", [
      zodLiteralArgument(pattern),
      zodLiteralArgument(zodRegexFlagsText(flags)),
    ]),
  required: (object: ZodExpression, keys: readonly [string, ...string[]]): ZodExpression =>
    zodCall(object, "required", [zodArrayArgument(keys.map((key) => zodLiteralArgument(key)))]),
  runtimeGuard: (
    expression: ZodExpression,
    program: ZodRuntimeProgramId,
    placement: ZodRuntimeGuardPlacement,
  ): ZodExpression => zodRuntimeGuard(expression, program, placement),
  strict: (object: ZodExpression): ZodExpression => zodCall(object, "strict"),
  string: (): ZodExpression => zodFactory("string"),
  tuple: (items: readonly ZodExpression[]): ZodExpression =>
    zodFactory("tuple", [zodArrayArgument(items.map((item) => zodExpressionArgument(item)))]),
  union: (options: readonly [ZodExpression, ZodExpression, ...ZodExpression[]]): ZodExpression =>
    zodFactory("union", [zodArrayArgument(options.map((option) => zodExpressionArgument(option)))]),
  unknown: (): ZodExpression => zodFactory("unknown"),
  xor: (options: readonly [ZodExpression, ZodExpression, ...ZodExpression[]]): ZodExpression =>
    zodFactory("xor", [zodArrayArgument(options.map((option) => zodExpressionArgument(option)))]),
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
