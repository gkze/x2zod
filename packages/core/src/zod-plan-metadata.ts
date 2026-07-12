export const zodFactoryNames = [
  "array",
  "boolean",
  "enum",
  "literal",
  "never",
  "null",
  "number",
  "object",
  "intersection",
  "record",
  "string",
  "tuple",
  "union",
  "unknown",
  "xor",
] as const;

export type ZodFactoryName = (typeof zodFactoryNames)[number];

export const zodNoArgumentFactoryNames: readonly [
  "boolean",
  "never",
  "null",
  "number",
  "string",
  "unknown",
] = ["boolean", "never", "null", "number", "string", "unknown"] as const;

export type ZodNoArgumentFactoryName = (typeof zodNoArgumentFactoryNames)[number];
export type ZodArgumentFactoryName = Exclude<ZodFactoryName, ZodNoArgumentFactoryName>;

export type ZodArgumentKind = "array" | "expression" | "literal" | "object";
export type ZodArrayElementKind = "expression" | "stringLiteral";
export type ZodLiteralArgumentValueType = "number" | "string";

export type ZodArgumentMetadata =
  | Readonly<{ kind: "none"; expected: string }>
  | Readonly<{ argumentKind: ZodArgumentKind; expected: string; kind: "single" }>
  | Readonly<{ expected: string; kind: "literal"; valueType: ZodLiteralArgumentValueType }>
  | Readonly<{ argumentKinds: readonly ZodArgumentKind[]; expected: string; kind: "sequence" }>
  | Readonly<{
      elementKind: ZodArrayElementKind;
      expected: string;
      kind: "array";
      maximumLength?: number | undefined;
      minimumLength: number;
      unique?: boolean | undefined;
    }>;

export type ZodFactoryMetadata = Readonly<{ args: ZodArgumentMetadata }>;

const noArguments = { expected: "no arguments", kind: "none" } satisfies ZodArgumentMetadata;
const expressionArgument = {
  argumentKind: "expression",
  expected: "one expression argument",
  kind: "single",
} satisfies ZodArgumentMetadata;
const objectArgument = {
  argumentKind: "object",
  expected: "one object argument",
  kind: "single",
} satisfies ZodArgumentMetadata;
const literalArgument = {
  argumentKind: "literal",
  expected: "one literal argument",
  kind: "single",
} satisfies ZodArgumentMetadata;
const numberLiteralArgument = {
  expected: "one number literal argument",
  kind: "literal",
  valueType: "number",
} satisfies ZodArgumentMetadata;
const stringLiteralArgument = {
  expected: "one string literal argument",
  kind: "literal",
  valueType: "string",
} satisfies ZodArgumentMetadata;
const twoExpressionArguments = {
  argumentKinds: ["expression", "expression"],
  expected: "two expression arguments",
  kind: "sequence",
} satisfies ZodArgumentMetadata;
const stringLiteralArrayArgument = {
  elementKind: "stringLiteral",
  expected: "an array of at least one string literal argument",
  kind: "array",
  minimumLength: 1,
} satisfies ZodArgumentMetadata;
const uniqueStringLiteralArrayArgument = {
  ...stringLiteralArrayArgument,
  unique: true,
} satisfies ZodArgumentMetadata;
const expressionArrayArgument = (minimumLength: number, expected: string): ZodArgumentMetadata => ({
  elementKind: "expression",
  expected,
  kind: "array",
  minimumLength,
});

export const zodFactoryMetadata: Record<ZodFactoryName, ZodFactoryMetadata> = {
  array: { args: expressionArgument },
  boolean: { args: noArguments },
  enum: { args: stringLiteralArrayArgument },
  literal: { args: literalArgument },
  never: { args: noArguments },
  null: { args: noArguments },
  number: { args: noArguments },
  object: { args: objectArgument },
  intersection: { args: twoExpressionArguments },
  record: { args: twoExpressionArguments },
  string: { args: noArguments },
  tuple: { args: expressionArrayArgument(1, "an array of at least one expression argument") },
  union: { args: expressionArrayArgument(2, "an array of at least two expression arguments") },
  unknown: { args: noArguments },
  xor: { args: expressionArrayArgument(2, "an array of at least two expression arguments") },
};

export const zodMethodNames = [
  "catchall",
  "gt",
  "gte",
  "int",
  "lt",
  "lte",
  "max",
  "min",
  "nullable",
  "optional",
  "passthrough",
  "regex",
  "required",
  "strict",
] as const;
export const zodKnownMethodNames: typeof zodMethodNames = zodMethodNames;

export type ZodKnownMethodName = (typeof zodMethodNames)[number];
export type ZodMethodName = ZodKnownMethodName;

export const zodNoArgumentMethodNames: readonly [
  "int",
  "nullable",
  "optional",
  "passthrough",
  "strict",
] = ["int", "nullable", "optional", "passthrough", "strict"] as const;

export type ZodNoArgumentMethodName = (typeof zodNoArgumentMethodNames)[number];
export type ZodArgumentMethodName = Exclude<ZodKnownMethodName, ZodNoArgumentMethodName>;

export type ZodReceiverRequirement =
  | "any"
  | "array"
  | "arrayOrString"
  | "number"
  | "object"
  | "string";
export type ZodMethodPrintStrategy = "default" | "regex" | "requiredKeys";

export type ZodMethodSpec = Readonly<{
  args: ZodArgumentMetadata;
  printArgument: ZodMethodPrintStrategy;
  receiver: ZodReceiverRequirement;
  wrapsReceiver: boolean;
}>;

const methodSpec = (
  args: ZodArgumentMetadata,
  receiver: ZodReceiverRequirement,
  printArgument: ZodMethodPrintStrategy = "default",
): ZodMethodSpec => ({ args, printArgument, receiver, wrapsReceiver: false });

const wrappingMethodSpec = (args: ZodArgumentMetadata): ZodMethodSpec => ({
  args,
  printArgument: "default",
  receiver: "any",
  wrapsReceiver: true,
});

export const zodMethodSpecs: Record<ZodKnownMethodName, ZodMethodSpec> = {
  catchall: methodSpec(expressionArgument, "object"),
  gt: methodSpec(numberLiteralArgument, "number"),
  gte: methodSpec(numberLiteralArgument, "number"),
  int: methodSpec(noArguments, "number"),
  lt: methodSpec(numberLiteralArgument, "number"),
  lte: methodSpec(numberLiteralArgument, "number"),
  max: methodSpec(numberLiteralArgument, "arrayOrString"),
  min: methodSpec(numberLiteralArgument, "arrayOrString"),
  nullable: wrappingMethodSpec(noArguments),
  optional: wrappingMethodSpec(noArguments),
  passthrough: methodSpec(noArguments, "object"),
  regex: methodSpec(stringLiteralArgument, "string", "regex"),
  required: methodSpec(uniqueStringLiteralArrayArgument, "object", "requiredKeys"),
  strict: methodSpec(noArguments, "object"),
};
export const zodMethodMetadata: Record<ZodKnownMethodName, ZodMethodSpec> = zodMethodSpecs;

export const zodMethodMetadataFor = (method: string): ZodMethodSpec | undefined =>
  isZodKnownMethodName(method) ? zodMethodSpecs[method] : undefined;

export const isZodKnownMethodName = (method: string): method is ZodKnownMethodName =>
  Object.hasOwn(zodMethodSpecs, method);

export const zodRequiredMethodName: ZodKnownMethodName = "required";
