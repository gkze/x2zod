import {
  choice,
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
  OptionOptions,
  Parser,
  ValueParser,
  ValueParserResult,
} from "@optique/core";
import type { z } from "zod/v4";

import { analyzeZodCLIFields } from "./zod-cli-analysis";
import type { ZodCLIField, ZodCLIValue } from "./zod-cli-analysis";
import { readCLIMetadata } from "./zod-cli-metadata";
import type { ZodCLIOptionFieldMetadata, ZodCLIOptionMetadata } from "./zod-cli-metadata";
import { objectShape, unwrapRootObjectSchema } from "./zod-introspection";
import type { ZodSchema } from "./zod-introspection";

export { ZodCLIOptionSchemaError } from "./zod-cli-errors";
export { withCLI } from "./zod-cli-metadata";
export type { ZodCLIOptionFieldMetadata, ZodCLIOptionMetadata } from "./zod-cli-metadata";

type ZodObjectToOptiqueBehavior = Readonly<{ defaultHelp: "show" | "hide"; validate: boolean }>;

const schemaBehavior: ZodObjectToOptiqueBehavior = { defaultHelp: "show", validate: true };
const overrideBehavior: ZodObjectToOptiqueBehavior = { defaultHelp: "hide", validate: false };

export const zodObjectToOptique = <TSchema extends ZodSchema>(
  schema: TSchema,
): Parser<"sync", z.output<TSchema>> =>
  createObjectParser<z.output<TSchema>>(schema, schemaBehavior);

export const zodObjectToOptiqueOverrides = (
  schema: ZodSchema,
): Parser<"sync", Readonly<Record<string, unknown>>> =>
  createObjectParser<Readonly<Record<string, unknown>>>(schema, overrideBehavior);

export const assertSupportedZodCLIOptionSchema = (schema: ZodSchema): void => {
  analyzeZodCLIFields(schema);
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
  const fieldParsers = Object.fromEntries(
    analyzeZodCLIFields(schema).map((field) => [
      field.fieldName,
      createFieldParser(field, behavior),
    ]),
  );

  return map(object(fieldParsers), (value) => {
    const stripped = stripUndefinedProperties(value);
    return behavior.validate ? schema.parse(stripped) : stripped;
  }) as Parser<"sync", TOutput>;
};

const createFieldParser = (field: ZodCLIField, behavior: ZodObjectToOptiqueBehavior): Parser => {
  const valueOption = option(
    ...field.optionNames,
    valueParserFor(field.value),
    optionOptions(field.metadata),
  );
  const baseParser: Parser = field.repeatable ? multiple(valueOption, { min: 1 }) : valueOption;
  if (!field.optional) return baseParser;

  // Keep omitted values absent until the final object parse, including defaults with refinements.
  const parser = optional(baseParser);
  if (behavior.defaultHelp === "hide") return parser;

  // Only Zod can resolve defaults inside unions and effects. Evaluate the preview at help time.
  const missingInput: unknown = undefined;
  const documentation = withDefault(baseParser, () => {
    const result = field.schema.safeParse(missingInput);
    return result.success ? result.data : undefined;
  });
  return { ...parser, getDocFragments: documentation.getDocFragments.bind(documentation) };
};

const valueParserFor = (value: ZodCLIValue): ValueParser =>
  value.kind === "enum"
    ? choice(value.values, { metavar: value.valueName })
    : scalarValueParsers[value.kind](value.valueName);

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

const scalarValueParsers = {
  boolean: booleanValueParser,
  integer: (valueName: NonEmptyString): ValueParser => integer({ metavar: valueName }),
  number: (valueName: NonEmptyString): ValueParser => float({ metavar: valueName }),
  string: (valueName: NonEmptyString): ValueParser => string({ metavar: valueName }),
};

const optionOptions = (metadata: ZodCLIOptionMetadata): OptionOptions =>
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
