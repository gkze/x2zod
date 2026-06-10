export const zodFactoryNames = [
  "array",
  "boolean",
  "enum",
  "literal",
  "never",
  "null",
  "number",
  "object",
  "string",
  "tuple",
  "union",
  "unknown",
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
  | Readonly<{
      elementKind: ZodArrayElementKind;
      expected: string;
      kind: "array";
      minimumLength: number;
      unique?: boolean | undefined;
    }>;

export type ZodFactoryMetadata = Readonly<{ args: ZodArgumentMetadata }>;

export const zodFactoryMetadata: Record<ZodFactoryName, ZodFactoryMetadata> = {
  array: {
    args: { argumentKind: "expression", expected: "one expression argument", kind: "single" },
  },
  boolean: { args: { expected: "no arguments", kind: "none" } },
  enum: {
    args: {
      elementKind: "stringLiteral",
      expected: "an array of at least one string literal argument",
      kind: "array",
      minimumLength: 1,
    },
  },
  literal: { args: { argumentKind: "literal", expected: "one literal argument", kind: "single" } },
  never: { args: { expected: "no arguments", kind: "none" } },
  null: { args: { expected: "no arguments", kind: "none" } },
  number: { args: { expected: "no arguments", kind: "none" } },
  object: { args: { argumentKind: "object", expected: "one object argument", kind: "single" } },
  string: { args: { expected: "no arguments", kind: "none" } },
  tuple: {
    args: {
      elementKind: "expression",
      expected: "an array of at least one expression argument",
      kind: "array",
      minimumLength: 1,
    },
  },
  union: {
    args: {
      elementKind: "expression",
      expected: "an array of at least two expression arguments",
      kind: "array",
      minimumLength: 2,
    },
  },
  unknown: { args: { expected: "no arguments", kind: "none" } },
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

export type ZodReceiverRequirement = "any" | "array" | "number" | "object" | "string";
export type ZodMethodPrintStrategy = "default" | "regex" | "requiredKeys";

export type ZodMethodSpec = Readonly<{
  args: ZodArgumentMetadata;
  printArgument: ZodMethodPrintStrategy;
  receiver: ZodReceiverRequirement;
  wrapsReceiver: boolean;
}>;

export const zodMethodSpecs: Record<ZodKnownMethodName, ZodMethodSpec> = {
  catchall: {
    args: { argumentKind: "expression", expected: "one expression argument", kind: "single" },
    printArgument: "default",
    receiver: "object",
    wrapsReceiver: false,
  },
  gt: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "number",
    wrapsReceiver: false,
  },
  gte: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "number",
    wrapsReceiver: false,
  },
  int: {
    args: { expected: "no arguments", kind: "none" },
    printArgument: "default",
    receiver: "number",
    wrapsReceiver: false,
  },
  lt: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "number",
    wrapsReceiver: false,
  },
  lte: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "number",
    wrapsReceiver: false,
  },
  max: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "array",
    wrapsReceiver: false,
  },
  min: {
    args: { expected: "one number literal argument", kind: "literal", valueType: "number" },
    printArgument: "default",
    receiver: "array",
    wrapsReceiver: false,
  },
  nullable: {
    args: { expected: "no arguments", kind: "none" },
    printArgument: "default",
    receiver: "any",
    wrapsReceiver: true,
  },
  optional: {
    args: { expected: "no arguments", kind: "none" },
    printArgument: "default",
    receiver: "any",
    wrapsReceiver: true,
  },
  passthrough: {
    args: { expected: "no arguments", kind: "none" },
    printArgument: "default",
    receiver: "object",
    wrapsReceiver: false,
  },
  regex: {
    args: { expected: "one string literal argument", kind: "literal", valueType: "string" },
    printArgument: "regex",
    receiver: "string",
    wrapsReceiver: false,
  },
  required: {
    args: {
      elementKind: "stringLiteral",
      expected: "an array of at least one string literal argument",
      kind: "array",
      minimumLength: 1,
      unique: true,
    },
    printArgument: "requiredKeys",
    receiver: "object",
    wrapsReceiver: false,
  },
  strict: {
    args: { expected: "no arguments", kind: "none" },
    printArgument: "default",
    receiver: "object",
    wrapsReceiver: false,
  },
};
export const zodMethodMetadata: Record<ZodKnownMethodName, ZodMethodSpec> = zodMethodSpecs;

export const zodMethodMetadataFor = (method: string): ZodMethodSpec | undefined =>
  isZodKnownMethodName(method) ? zodMethodSpecs[method] : undefined;

export const isZodKnownMethodName = (method: string): method is ZodKnownMethodName =>
  Object.hasOwn(zodMethodSpecs, method);

export const zodRequiredMethodName: ZodKnownMethodName = "required";
