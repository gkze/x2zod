import {
  choice,
  ensureNonEmptyString,
  float,
  integer,
  map,
  multiple,
  object,
  option,
  optional,
  string,
  withDefault,
} from "@optique/core";
import type {
  Message,
  NonEmptyString,
  OptionName,
  OptionOptions,
  Parser,
  ValueParser,
  ValueParserResult,
} from "@optique/core";
import type { z } from "zod/v4";

type UnknownRecord = Readonly<Record<string, unknown>>;
type ZodSchema = z.ZodType;
type ZodSchemaShape = Readonly<Record<string, ZodSchema>>;

type ZodDef = Readonly<{
  catchall?: unknown;
  check?: unknown;
  checks?: readonly unknown[];
  defaultValue?: unknown;
  element?: unknown;
  entries?: unknown;
  format?: unknown;
  innerType?: unknown;
  shape?: unknown;
  type?: unknown;
}>;

const ZOD_INTERNALS_KEY = "_zod";

type AbsenceBehavior =
  | Readonly<{ type: "default"; value: () => unknown }>
  | Readonly<{ type: "optional" }>
  | Readonly<{ type: "required" }>;

type FieldParserContext = Readonly<{
  metadata: ZodCliOptionMetadata;
  optionNames: readonly [OptionName, OptionName];
  path: readonly string[];
}>;

type OptionNameSourceContext = Readonly<{ fieldName: string; path: readonly string[] }>;

export type ZodCliOptionMetadata = Readonly<{
  description?: string | undefined;
  long?: string | undefined;
  short: string;
  valueName?: string | undefined;
}>;

export class ZodCliOptionSchemaError extends Error {
  public readonly path: readonly string[];

  public constructor(path: readonly string[], message: string) {
    super(`${formatPath(path)}: ${message}`);
    this.name = "ZodCliOptionSchemaError";
    this.path = path;
  }
}

export const withCli = <TSchema extends ZodSchema>(
  schema: TSchema,
  metadata: ZodCliOptionMetadata,
): TSchema => {
  const existingMetadata = schema.meta() as UnknownRecord | undefined;
  return schema.meta({ ...existingMetadata, x2zodCli: metadata } as never);
};

export const zodObjectToOptique = <TSchema extends ZodSchema>(
  schema: TSchema,
): Parser<"sync", z.output<TSchema>> => {
  const objectSchema = unwrapRootObjectSchema(schema);
  const shape = objectShape(objectSchema);
  const optionNameSources = new Map<string, string>();
  const fieldParsers: Record<string, Parser> = {};

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const path = [fieldName];
    const metadata = readCliMetadata(fieldSchema, path);
    const optionNames = optionNamesForField(fieldName, metadata, path);
    const fieldContext = { metadata, optionNames, path };
    assertUniqueOptionNames(optionNameSources, optionNames, { fieldName, path });
    fieldParsers[fieldName] = createFieldParser(fieldSchema, fieldContext);
  }

  return map(object(fieldParsers), (value) =>
    schema.parse(stripUndefinedProperties(value)),
  ) as Parser<"sync", z.output<TSchema>>;
};

const formatPath = (path: readonly string[]): string =>
  path.length === 0 ? "<root>" : path.join(".");

const schemaError = (path: readonly string[], message: string): ZodCliOptionSchemaError =>
  new ZodCliOptionSchemaError(path, message);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): value is ZodSchema =>
  isRecord(value) &&
  typeof value["parse"] === "function" &&
  typeof value["safeParse"] === "function";

const schemaDef = (schema: ZodSchema, path: readonly string[]): ZodDef => {
  const schemaRecord = schema as unknown as Readonly<{
    _zod?: Readonly<{ def?: unknown }>;
    def?: unknown;
  }>;
  const def = schemaRecord.def ?? schemaRecord[ZOD_INTERNALS_KEY]?.def;

  if (!isRecord(def)) throw schemaError(path, "schema has no introspectable Zod definition");
  return def;
};

const schemaType = (schema: ZodSchema, path: readonly string[]): string => {
  const { type } = schemaDef(schema, path);
  if (typeof type !== "string") throw schemaError(path, "schema definition has no type");
  return type;
};

const innerSchema = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  const { innerType } = schemaDef(schema, path);
  if (!isZodSchema(innerType))
    throw schemaError(path, "wrapper schema has no introspectable inner type");
  return innerType;
};

const isSupportedWrapperType = (type: string): boolean =>
  type === "default" || type === "optional" || type === "readonly";

const unwrapSupportedWrappers = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  let currentSchema = schema;

  for (;;) {
    const type = schemaType(currentSchema, path);
    if (!isSupportedWrapperType(type)) return currentSchema;
    currentSchema = innerSchema(currentSchema, path);
  }
};

const unwrapRootObjectSchema = (schema: ZodSchema): ZodSchema => {
  const type = schemaType(schema, []);
  return type === "readonly" ? innerSchema(schema, []) : schema;
};

const objectShape = (schema: ZodSchema): ZodSchemaShape => {
  const path: readonly string[] = [];
  const def = schemaDef(schema, path);

  if (def.type !== "object") throw schemaError(path, "expected a root Zod object schema");

  assertSupportedCatchall(def, path);

  const shapeCandidate = objectShapeCandidate(def);
  if (!isRecord(shapeCandidate))
    throw schemaError(path, "object schema has no introspectable shape");

  const shape: Record<string, ZodSchema> = {};
  for (const [fieldName, fieldSchema] of Object.entries(shapeCandidate)) {
    if (!isZodSchema(fieldSchema))
      throw schemaError([fieldName], "object field is not an introspectable Zod schema");
    shape[fieldName] = fieldSchema;
  }

  return shape;
};

const assertSupportedCatchall = (def: ZodDef, path: readonly string[]): void => {
  if (def.catchall === undefined) return;
  if (!isZodSchema(def.catchall)) throw schemaError(path, "object catchall is not introspectable");
  if (schemaType(def.catchall, [...path, "<catchall>"]) !== "never")
    throw schemaError(path, "object catchalls and passthrough keys are not supported");
};

const objectShapeCandidate = (def: ZodDef): unknown => {
  if (typeof def.shape !== "function") return def.shape;
  const getShape = def.shape as () => unknown;
  return getShape();
};

const readCliMetadata = (schema: ZodSchema, path: readonly string[]): ZodCliOptionMetadata => {
  const metadata = (schema.meta() as UnknownRecord | undefined)?.["x2zodCli"];
  if (metadata !== undefined) return parseCliMetadata(metadata, path);

  const type = schemaType(schema, path);
  if (isSupportedWrapperType(type)) return readCliMetadata(innerSchema(schema, path), path);

  throw schemaError(path, "missing CLI option metadata");
};

const parseCliMetadata = (value: unknown, path: readonly string[]): ZodCliOptionMetadata => {
  if (!isRecord(value)) throw schemaError(path, "CLI option metadata must be an object");

  const { description, long, short, valueName } = value;
  if (typeof short !== "string")
    throw schemaError(path, "CLI option metadata must include a short option");
  if (description !== undefined && typeof description !== "string")
    throw schemaError(path, "CLI option description must be a string");
  if (long !== undefined && typeof long !== "string")
    throw schemaError(path, "CLI long option must be a string");
  if (valueName !== undefined && typeof valueName !== "string")
    throw schemaError(path, "CLI option value name must be a string");

  return { description, long, short, valueName };
};

const optionNamesForField = (
  fieldName: string,
  metadata: ZodCliOptionMetadata,
  path: readonly string[],
): readonly [OptionName, OptionName] => {
  const shortOption = validateOptionName(metadata.short, "short", path);
  const longOption = validateOptionName(
    metadata.long ?? derivedLongOption(fieldName),
    "long",
    path,
  );
  return [shortOption, longOption];
};

const validateOptionName = (
  name: string,
  kind: "long" | "short",
  path: readonly string[],
): OptionName => {
  const pattern = kind === "short" ? /^-[A-Za-z0-9]$/u : /^--[A-Za-z][A-Za-z0-9-]*$/u;
  if (!pattern.test(name)) throw schemaError(path, `invalid ${kind} option name ${name}`);
  if (name === "-h" || name === "--help")
    throw schemaError(path, `reserved help option name ${name}`);
  return name as OptionName;
};

const derivedLongOption = (fieldName: string): string => {
  const kebabName = fieldName
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .replaceAll(/[^A-Za-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();

  return `--${kebabName}`;
};

const assertUniqueOptionNames = (
  sources: Map<string, string>,
  names: readonly OptionName[],
  context: OptionNameSourceContext,
): void => {
  for (const name of names) {
    const previousFieldName = sources.get(name);
    if (previousFieldName !== undefined)
      throw schemaError(
        context.path,
        `option name ${name} is already used by ${previousFieldName}`,
      );
    sources.set(name, context.fieldName);
  }
};

const createFieldParser = (schema: ZodSchema, context: FieldParserContext): Parser => {
  const baseParser = createRequiredFieldParser(schema, context);
  const absence = absenceBehaviorForSchema(schema);

  if (absence.type === "default") return withDefault(baseParser, absence.value);
  if (absence.type === "optional") return optional(baseParser);
  return baseParser;
};

const createRequiredFieldParser = (schema: ZodSchema, context: FieldParserContext): Parser => {
  const { metadata, optionNames, path } = context;
  const baseSchema = unwrapSupportedWrappers(schema, path);
  const type = schemaType(baseSchema, path);

  if (type === "array")
    return multiple(
      createValueOption(
        optionNames,
        valueParserForSchema(arrayElementSchema(baseSchema, path), metadata, [
          ...path,
          "<element>",
        ]),
        metadata,
      ),
      { min: 1 },
    );

  return createValueOption(optionNames, valueParserForSchema(baseSchema, metadata, path), metadata);
};

const createValueOption = (
  optionNames: readonly [OptionName, OptionName],
  valueParser: ValueParser,
  metadata: ZodCliOptionMetadata,
): Parser => option(...optionNames, valueParser, optionOptions(metadata));

const absenceBehaviorForSchema = (schema: ZodSchema): AbsenceBehavior => {
  const missingInput: unknown = undefined;
  const absentParseResult = schema.safeParse(missingInput);
  if (!absentParseResult.success) return { type: "required" };
  return absentParseResult.data === undefined
    ? { type: "optional" }
    : { type: "default", value: () => schema.parse(missingInput) };
};

const valueParserForSchema = (
  schema: ZodSchema,
  metadata: ZodCliOptionMetadata,
  path: readonly string[],
): ValueParser => {
  const def = schemaDef(schema, path);

  switch (def.type) {
    case "boolean": {
      return booleanValueParser(optionValueName(metadata, "BOOLEAN"));
    }
    case "enum": {
      return enumValueParser(def, metadata, path);
    }
    case "number": {
      return isIntegerNumber(def)
        ? integer({ metavar: optionValueName(metadata, "INTEGER") })
        : float({ metavar: optionValueName(metadata, "NUMBER") });
    }
    case "string": {
      return string({ metavar: optionValueName(metadata, "STRING") });
    }
    default: {
      throw schemaError(path, `unsupported CLI option schema type ${formatSchemaType(def.type)}`);
    }
  }
};

const formatSchemaType = (type: unknown): string => (typeof type === "string" ? type : "<unknown>");

const arrayElementSchema = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  const { element } = schemaDef(schema, path);
  if (!isZodSchema(element)) throw schemaError(path, "array schema has no element schema");
  return unwrapSupportedWrappers(element, [...path, "<element>"]);
};

const enumValueParser = (
  def: ZodDef,
  metadata: ZodCliOptionMetadata,
  path: readonly string[],
): ValueParser => {
  if (!isRecord(def.entries)) throw schemaError(path, "enum schema has no entries");
  const values = [...new Set(Object.values(def.entries))];
  if (values.length === 0) throw schemaError(path, "empty enums are not supported");
  if (!values.every((value) => typeof value === "string"))
    throw schemaError(path, "only string enums are supported");
  return choice(values as readonly string[], { metavar: optionValueName(metadata, "VALUE") });
};

const isIntegerNumber = (def: ZodDef): boolean =>
  isSafeIntegerNumberFormat(def) ||
  (def.checks ?? []).some((check) => {
    if (!isRecord(check)) return false;
    const nestedDef = isRecord(check["def"]) ? (check["def"] as ZodDef) : undefined;
    return (
      isSafeIntegerNumberFormat(check as ZodDef) ||
      (nestedDef !== undefined && isSafeIntegerNumberFormat(nestedDef))
    );
  });

const isSafeIntegerNumberFormat = (def: ZodDef): boolean =>
  def.check === "number_format" && def.format === "safeint";

const booleanValueParser = (valueName: NonEmptyString): ValueParser<"sync", boolean> => ({
  choices: [true, false],
  format: String,
  metavar: valueName,
  mode: "sync",
  parse: (input): ValueParserResult<boolean> => {
    if (input === "true") return { success: true, value: true };
    if (input === "false") return { success: true, value: false };
    return { error: plainMessage("Expected true or false."), success: false };
  },
  placeholder: false,
});

const optionValueName = (metadata: ZodCliOptionMetadata, fallback: string): NonEmptyString => {
  const valueName = metadata.valueName ?? fallback;
  try {
    ensureNonEmptyString(valueName);
    return valueName;
  } catch (error) {
    if (error instanceof Error)
      throw new ZodCliOptionSchemaError([], `invalid CLI value name: ${error.message}`);
    throw error;
  }
};

const optionOptions = (metadata: ZodCliOptionMetadata): OptionOptions =>
  metadata.description === undefined ? {} : { description: plainMessage(metadata.description) };

const plainMessage = (value: string): Message => [{ text: value, type: "text" }];

const stripUndefinedProperties = (
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value))
    if (fieldValue !== undefined) result[key] = fieldValue;

  return result;
};
