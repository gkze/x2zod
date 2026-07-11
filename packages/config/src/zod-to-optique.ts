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

import { isRecord } from "./structural";
import { schemaError, ZodCLIOptionSchemaError } from "./zod-cli-errors";
import { optionNamesForField, readCLIMetadata } from "./zod-cli-metadata";
import type { ZodCLIOptionFieldMetadata, ZodCLIOptionMetadata } from "./zod-cli-metadata";
import {
  arrayElementSchema,
  objectShape,
  schemaDef,
  unwrapRootObjectSchema,
  unwrapSupportedWrappers,
} from "./zod-introspection";
import type { ZodDef, ZodSchema } from "./zod-introspection";

export { ZodCLIOptionSchemaError } from "./zod-cli-errors";
export { withCLI } from "./zod-cli-metadata";
export type { ZodCLIOptionFieldMetadata, ZodCLIOptionMetadata } from "./zod-cli-metadata";

type AbsenceBehavior =
  | Readonly<{ type: "default"; value: () => unknown }>
  | Readonly<{ type: "optional" }>
  | Readonly<{ type: "required" }>;

type FieldParserContext = Readonly<{
  metadata: ZodCLIOptionMetadata;
  optionNames: readonly [OptionName, OptionName];
  path: readonly string[];
}>;

type OptionNameSourceContext = Readonly<{ fieldName: string; path: readonly string[] }>;
type ZodObjectToOptiqueBehavior = Readonly<{ defaults: "apply" | "suppress"; validate: boolean }>;

const schemaBehavior: ZodObjectToOptiqueBehavior = { defaults: "apply", validate: true };
const overrideBehavior: ZodObjectToOptiqueBehavior = { defaults: "suppress", validate: false };

export const zodObjectToOptique = <TSchema extends ZodSchema>(
  schema: TSchema,
): Parser<"sync", z.output<TSchema>> =>
  createObjectParser<z.output<TSchema>>(schema, schemaBehavior);

export const zodObjectToOptiqueOverrides = (
  schema: ZodSchema,
): Parser<"sync", Readonly<Record<string, unknown>>> =>
  createObjectParser<Readonly<Record<string, unknown>>>(schema, overrideBehavior);

export const assertSupportedZodCLIOptionSchema = (schema: ZodSchema): void => {
  createObjectParser<Readonly<Record<string, unknown>>>(schema, overrideBehavior);
};

export const zodCLIOptionFieldMetadata = (
  schema: ZodSchema,
): readonly ZodCLIOptionFieldMetadata[] => {
  const objectSchema = unwrapRootObjectSchema(schema);
  const shape = objectShape(objectSchema);
  return Object.entries(shape).map(([fieldName, fieldSchema]) => ({
    fieldName,
    metadata: readCLIMetadata(fieldSchema, [fieldName]),
  }));
};

const createObjectParser = <TOutput>(
  schema: ZodSchema,
  behavior: ZodObjectToOptiqueBehavior,
): Parser<"sync", TOutput> => {
  const objectSchema = unwrapRootObjectSchema(schema);
  const shape = objectShape(objectSchema);
  const optionNameSources = new Map<string, string>();
  const fieldParsers: Record<string, Parser> = {};

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const path = [fieldName];
    const metadata = readCLIMetadata(fieldSchema, path);
    const optionNames = optionNamesForField(fieldName, metadata, path);
    const fieldContext = { metadata, optionNames, path };
    assertUniqueOptionNames(optionNameSources, optionNames, { fieldName, path });
    fieldParsers[fieldName] = createFieldParser(fieldSchema, fieldContext, behavior);
  }

  return map(object(fieldParsers), (value) => {
    const stripped = stripUndefinedProperties(value);
    return behavior.validate ? schema.parse(stripped) : stripped;
  }) as Parser<"sync", TOutput>;
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

const createFieldParser = (
  schema: ZodSchema,
  context: FieldParserContext,
  behavior: ZodObjectToOptiqueBehavior,
): Parser => {
  const baseParser = createRequiredFieldParser(schema, context);
  const absence = absenceBehaviorForSchema(schema);

  if (absence.type === "default")
    return behavior.defaults === "apply"
      ? withDefault(baseParser, absence.value)
      : optional(baseParser);
  if (absence.type === "optional") return optional(baseParser);
  return baseParser;
};

const createRequiredFieldParser = (schema: ZodSchema, context: FieldParserContext): Parser => {
  const { metadata, optionNames, path } = context;
  const baseSchema = unwrapSupportedWrappers(schema, path);
  const def = schemaDef(baseSchema, path);

  if (metadata.valueMode === "string-array" || metadata.valueMode === "json-file-map")
    return multiple(
      createValueOption(
        optionNames,
        string({ metavar: optionValueName(metadata, "VALUE") }),
        metadata,
      ),
      { min: 1 },
    );

  if (def.type === "array")
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
  metadata: ZodCLIOptionMetadata,
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
  metadata: ZodCLIOptionMetadata,
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

const enumValueParser = (
  def: ZodDef,
  metadata: ZodCLIOptionMetadata,
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
      isSafeIntegerNumberFormat(check) ||
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

const optionValueName = (metadata: ZodCLIOptionMetadata, fallback: string): NonEmptyString => {
  const valueName = metadata.valueName ?? fallback;
  try {
    ensureNonEmptyString(valueName);
    return valueName;
  } catch (error) {
    if (error instanceof Error)
      throw new ZodCLIOptionSchemaError([], `invalid CLI value name: ${error.message}`);
    throw error;
  }
};

const optionOptions = (metadata: ZodCLIOptionMetadata): OptionOptions =>
  metadata.description === undefined ? {} : { description: plainMessage(metadata.description) };

const formatSchemaType = (type: unknown): string => (typeof type === "string" ? type : "<unknown>");

const plainMessage = (value: string): Message => [{ text: value, type: "text" }];

const stripUndefinedProperties = (
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value))
    if (fieldValue !== undefined) result[key] = fieldValue;

  return result;
};
