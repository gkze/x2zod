export type ZodArgumentKind = "array" | "expression" | "helper" | "literal" | "object";
export type ZodArrayElementKind = "expression" | "stringLiteral";
export type ZodLiteralArgumentValueType = "number" | "string";

export type ZodArgumentMetadata =
  | Readonly<{ kind: "none"; expected: string }>
  | Readonly<{ argumentKind: ZodArgumentKind; expected: string; kind: "single" }>
  | Readonly<{ expected: string; kind: "literal"; valueType: ZodLiteralArgumentValueType }>
  | Readonly<{ expected: string; kind: "regex" }>
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
export type ZodReceiverRequirement = ZodFactoryName | "any" | readonly ZodFactoryName[];
export type ZodMethodPrintStrategy = "default" | "regex" | "requiredKeys";
export type ZodMethodSpec = Readonly<{
  args: ZodArgumentMetadata;
  printArgument: ZodMethodPrintStrategy;
  receiver: ZodReceiverRequirement;
  wrapsReceiver: boolean;
}>;

type ArgumentSpec<TKind extends ZodArgumentMetadata["kind"]> = Extract<
  ZodArgumentMetadata,
  Readonly<{ kind: TKind }>
>;
type SingleArgumentSpec<TKind extends ZodArgumentKind> = ArgumentSpec<"single"> &
  Readonly<{ argumentKind: TKind }>;
type LiteralArgumentSpec<TType extends ZodLiteralArgumentValueType> = ArgumentSpec<"literal"> &
  Readonly<{ valueType: TType }>;
type ArrayArgumentSpec<TKind extends ZodArrayElementKind> = ArgumentSpec<"array"> &
  Readonly<{ elementKind: TKind }>;
type ArgumentSpecs = Readonly<{
  none: ArgumentSpec<"none">;
  expression: SingleArgumentSpec<"expression">;
  object: SingleArgumentSpec<"object">;
  literal: SingleArgumentSpec<"literal">;
  helper: SingleArgumentSpec<"helper">;
  numberLiteral: LiteralArgumentSpec<"number">;
  stringLiteral: LiteralArgumentSpec<"string">;
  regex: ArgumentSpec<"regex">;
  twoExpressions: ArgumentSpec<"sequence"> &
    Readonly<{ argumentKinds: readonly ["expression", "expression"] }>;
  stringLiterals: ArrayArgumentSpec<"stringLiteral">;
  uniqueStringLiterals: ArrayArgumentSpec<"stringLiteral">;
  expressions: ArrayArgumentSpec<"expression">;
  multipleExpressions: ArrayArgumentSpec<"expression">;
}>;

const argumentSpecs: ArgumentSpecs = {
  none: { expected: "no arguments", kind: "none" },
  expression: { argumentKind: "expression", expected: "one expression argument", kind: "single" },
  object: { argumentKind: "object", expected: "one object argument", kind: "single" },
  literal: { argumentKind: "literal", expected: "one literal argument", kind: "single" },
  helper: { argumentKind: "helper", expected: "one built-in helper argument", kind: "single" },
  numberLiteral: { expected: "one number literal argument", kind: "literal", valueType: "number" },
  stringLiteral: { expected: "one string literal argument", kind: "literal", valueType: "string" },
  regex: { expected: "a pattern string and optional valid ECMAScript flag string", kind: "regex" },
  twoExpressions: {
    argumentKinds: ["expression", "expression"],
    expected: "two expression arguments",
    kind: "sequence",
  },
  stringLiterals: {
    elementKind: "stringLiteral",
    expected: "an array of at least one string literal argument",
    kind: "array",
    minimumLength: 1,
  },
  uniqueStringLiterals: {
    elementKind: "stringLiteral",
    expected: "an array of at least one string literal argument",
    kind: "array",
    minimumLength: 1,
    unique: true,
  },
  expressions: {
    elementKind: "expression",
    expected: "an array of expression arguments",
    kind: "array",
    minimumLength: 0,
  },
  multipleExpressions: {
    elementKind: "expression",
    expected: "an array of at least two expression arguments",
    kind: "array",
    minimumLength: 2,
  },
};

type ArgumentSpecName = keyof typeof argumentSpecs;
type NoArgumentName<TSpecs extends Record<string, ArgumentSpecName>> = {
  [TName in keyof TSpecs]: (typeof argumentSpecs)[TSpecs[TName]]["kind"] extends "none"
    ? TName
    : never;
}[keyof TSpecs];

const factorySpecs = {
  array: "expression",
  boolean: "none",
  enum: "stringLiterals",
  literal: "literal",
  never: "none",
  null: "none",
  number: "none",
  object: "object",
  intersection: "twoExpressions",
  record: "twoExpressions",
  string: "none",
  tuple: "expressions",
  union: "multipleExpressions",
  unknown: "none",
  xor: "multipleExpressions",
} as const;

export type ZodFactoryName = keyof typeof factorySpecs;
export type ZodFactoryArgumentMetadata<TName extends ZodFactoryName> =
  (typeof argumentSpecs)[(typeof factorySpecs)[TName]];
export const zodFactoryMetadata: Record<ZodFactoryName, ZodFactoryMetadata> = {
  array: { args: argumentSpecs[factorySpecs.array] },
  boolean: { args: argumentSpecs[factorySpecs.boolean] },
  enum: { args: argumentSpecs[factorySpecs.enum] },
  literal: { args: argumentSpecs[factorySpecs.literal] },
  never: { args: argumentSpecs[factorySpecs.never] },
  null: { args: argumentSpecs[factorySpecs.null] },
  number: { args: argumentSpecs[factorySpecs.number] },
  object: { args: argumentSpecs[factorySpecs.object] },
  intersection: { args: argumentSpecs[factorySpecs.intersection] },
  record: { args: argumentSpecs[factorySpecs.record] },
  string: { args: argumentSpecs[factorySpecs.string] },
  tuple: { args: argumentSpecs[factorySpecs.tuple] },
  union: { args: argumentSpecs[factorySpecs.union] },
  unknown: { args: argumentSpecs[factorySpecs.unknown] },
  xor: { args: argumentSpecs[factorySpecs.xor] },
};
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
export type ZodNoArgumentFactoryName = NoArgumentName<typeof factorySpecs>;
export const zodNoArgumentFactoryNames = [
  "boolean",
  "never",
  "null",
  "number",
  "string",
  "unknown",
] as const;
export type ZodArgumentFactoryName = Exclude<ZodFactoryName, ZodNoArgumentFactoryName>;

const methodSpecs = {
  catchall: { args: "expression", receiver: "object" },
  describe: { args: "stringLiteral", receiver: "any" },
  gt: { args: "numberLiteral", receiver: "number" },
  gte: { args: "numberLiteral", receiver: "number" },
  int: { args: "none", receiver: "number" },
  lt: { args: "numberLiteral", receiver: "number" },
  lte: { args: "numberLiteral", receiver: "number" },
  max: { args: "numberLiteral", receiver: ["array", "string"] },
  min: { args: "numberLiteral", receiver: ["array", "string"] },
  nullable: { args: "none", receiver: "any", wrapsReceiver: true },
  optional: { args: "none", receiver: "any", wrapsReceiver: true },
  passthrough: { args: "none", receiver: "object" },
  refine: { args: "helper", receiver: "any" },
  regex: { args: "regex", receiver: "string", printArgument: "regex" },
  required: { args: "uniqueStringLiterals", receiver: "object", printArgument: "requiredKeys" },
  strict: { args: "none", receiver: "object" },
} as const;

export type ZodKnownMethodName = keyof typeof methodSpecs;
export type ZodMethodName = ZodKnownMethodName;
export type ZodMethodArgumentMetadata<TName extends ZodKnownMethodName> =
  (typeof argumentSpecs)[(typeof methodSpecs)[TName]["args"]];
const methodMetadata = (name: ZodKnownMethodName): ZodMethodSpec => ({
  printArgument: "default",
  wrapsReceiver: false,
  ...methodSpecs[name],
  args: argumentSpecs[methodSpecs[name].args],
});
export const zodMethodSpecs: Record<ZodKnownMethodName, ZodMethodSpec> = {
  catchall: methodMetadata("catchall"),
  describe: methodMetadata("describe"),
  gt: methodMetadata("gt"),
  gte: methodMetadata("gte"),
  int: methodMetadata("int"),
  lt: methodMetadata("lt"),
  lte: methodMetadata("lte"),
  max: methodMetadata("max"),
  min: methodMetadata("min"),
  nullable: methodMetadata("nullable"),
  optional: methodMetadata("optional"),
  passthrough: methodMetadata("passthrough"),
  refine: methodMetadata("refine"),
  regex: methodMetadata("regex"),
  required: methodMetadata("required"),
  strict: methodMetadata("strict"),
};
export const zodMethodMetadata: Record<ZodKnownMethodName, ZodMethodSpec> = zodMethodSpecs;
export const zodMethodNames = [
  "catchall",
  "describe",
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
  "refine",
  "regex",
  "required",
  "strict",
] as const;
export const zodKnownMethodNames: typeof zodMethodNames = zodMethodNames;
export type ZodNoArgumentMethodName = NoArgumentName<{
  [TName in ZodKnownMethodName]: (typeof methodSpecs)[TName]["args"];
}>;
export const zodNoArgumentMethodNames = [
  "int",
  "nullable",
  "optional",
  "passthrough",
  "strict",
] as const;

export const zodMethodMetadataFor = (method: string): ZodMethodSpec | undefined =>
  isZodKnownMethodName(method) ? zodMethodSpecs[method] : undefined;
export const isZodKnownMethodName = (method: string): method is ZodKnownMethodName =>
  Object.hasOwn(zodMethodSpecs, method);
export const zodRequiredMethodName: ZodKnownMethodName = "required";
