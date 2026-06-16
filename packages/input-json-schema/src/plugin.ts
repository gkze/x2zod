import { ok } from "@x2zod/core";
import type { InputDocument, InputPlugin, PreparedInput, Result } from "@x2zod/core";

import { resolveJsonSchemaDialect } from "./dialect";
import { parseJsonSchemaDocument } from "./document";
import type { ParsedJsonSchemaDocument } from "./document";
import { lowerJsonSchemaDocument } from "./lower";
import { jsonSchemaInputPluginKind, jsonSchemaInputPluginOptionsSchema } from "./options";
import type {
  JsonSchemaInputPluginKind,
  JsonSchemaInputPluginOptions,
  JsonSchemaInputPluginOptionsInput,
} from "./options";
import { preflightJsonSchema } from "./preflight";

export type JsonSchemaPreparedInput = ParsedJsonSchemaDocument &
  Readonly<{ dialect: JsonSchemaInputPluginOptions["dialect"] }>;

export type JsonSchemaInputPlugin = InputPlugin<
  JsonSchemaPreparedInput,
  JsonSchemaInputPluginOptions,
  JsonSchemaInputPluginOptionsInput,
  JsonSchemaInputPluginKind
>;

const mergePreparedDiagnostics = (
  prepared: PreparedInput<ParsedJsonSchemaDocument>,
  dialect: JsonSchemaInputPluginOptions["dialect"],
  ...results: readonly Result<unknown>[]
): Result<PreparedInput<JsonSchemaPreparedInput>> =>
  ok(
    { ...prepared, value: { ...prepared.value, dialect } },
    results.flatMap((result) => result.diagnostics ?? []),
  );

const prepareJsonSchemaDocument = (
  document: InputDocument,
  options: JsonSchemaInputPluginOptions,
): Result<PreparedInput<JsonSchemaPreparedInput>> => {
  const parsed = parseJsonSchemaDocument(document);
  if (!parsed.ok) return parsed;

  const dialect = resolveJsonSchemaDialect(
    parsed.value.value.schema,
    options.dialect,
    parsed.value.locations,
  );
  if (!dialect.ok) return dialect;

  const preflight = preflightJsonSchema({
    dialect: dialect.value,
    locations: parsed.value.locations,
    schema: parsed.value.value.schema,
    validator: options.validator,
  });
  if (!preflight.ok) return preflight;

  return mergePreparedDiagnostics(parsed.value, dialect.value, parsed, dialect, preflight);
};

export const jsonSchemaInputPlugin: JsonSchemaInputPlugin = {
  kind: jsonSchemaInputPluginKind,
  lower: async (input, options) => {
    await Promise.resolve();
    return lowerJsonSchemaDocument(input.value, options, input.locations);
  },
  optionsSchema: jsonSchemaInputPluginOptionsSchema,
  prepare: async (document, options) => {
    await Promise.resolve();
    return prepareJsonSchemaDocument(document, options);
  },
};
