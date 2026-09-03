import { err, ok } from "@x2zod/core";
import type { Diagnostic, InputDocument, InputPlugin, PreparedInput, Result } from "@x2zod/core";

import {
  declaredJsonSchemaDialect,
  resolveJsonSchemaDialect,
  resolveJsonSchemaVocabulary,
} from "./dialect";
import type { JsonSchemaMetaSchemaResolver } from "./dialect";
import { parseJsonSchemaDocument } from "./document";
import type { ParsedJsonSchemaDocument } from "./document";
import { normalizeUserExternalSchemaRegistry } from "./external-schema-registry";
import { lowerJsonSchemaDocument } from "./lower-document";
import { createJsonSchemaGraphMetaSchemaResolver } from "./meta-schema-resolution";
import { jsonSchemaInputPluginKind, jsonSchemaInputPluginOptionsSchema } from "./options";
import type {
  JsonSchemaDialect,
  JsonSchemaInputPluginKind,
  JsonSchemaInputPluginOptions,
  JsonSchemaInputPluginOptionsInput,
} from "./options";
import { preflightJsonSchema, validateJsonSchemaCustomMetaKeywords } from "./preflight";
import { jsonSchemaDocumentRetrievalUri } from "./reference";
import { buildJsonSchemaResourceGraph } from "./resource-graph";

export type JsonSchemaPreparedInput = ParsedJsonSchemaDocument &
  Readonly<{
    applicatorVocabulary: boolean;
    dialect: JsonSchemaDialect;
    formatAssertionVocabulary: boolean;
    unevaluatedVocabulary: boolean;
    validationVocabulary: boolean;
  }>;

export type JsonSchemaInputPlugin = InputPlugin<
  JsonSchemaPreparedInput,
  JsonSchemaInputPluginOptions,
  JsonSchemaInputPluginOptionsInput,
  JsonSchemaInputPluginKind
>;

const mergePreparedDiagnostics = (
  input: Readonly<{
    applicatorVocabulary: boolean;
    dialect: JsonSchemaDialect;
    formatAssertionVocabulary: boolean;
    prepared: PreparedInput<ParsedJsonSchemaDocument>;
    unevaluatedVocabulary: boolean;
    validationVocabulary: boolean;
  }>,
  ...results: readonly Result<unknown>[]
): Result<PreparedInput<JsonSchemaPreparedInput>> =>
  ok(
    {
      ...input.prepared,
      value: {
        ...input.prepared.value,
        applicatorVocabulary: input.applicatorVocabulary,
        dialect: input.dialect,
        formatAssertionVocabulary: input.formatAssertionVocabulary,
        unevaluatedVocabulary: input.unevaluatedVocabulary,
        validationVocabulary: input.validationVocabulary,
      },
    },
    results.flatMap((result) => result.diagnostics ?? []),
  );

const appendDiagnostics = <TValue>(
  result: Result<TValue>,
  diagnostics: readonly Diagnostic[],
): Result<TValue> => {
  if (diagnostics.length === 0) return result;
  const combined = [...(result.diagnostics ?? []), ...diagnostics];
  if (result.ok) return ok(result.value, combined);
  const [first, ...remaining] = combined;
  return first === undefined ? result : err(first, ...remaining);
};

const prepareJsonSchemaDocument = (
  document: InputDocument,
  options: JsonSchemaInputPluginOptions,
): Result<PreparedInput<JsonSchemaPreparedInput>> => {
  const parsed = parseJsonSchemaDocument(document);
  if (!parsed.ok) return parsed;

  const rootRetrievalUri = jsonSchemaDocumentRetrievalUri(parsed.value.value);
  const { externalSchemas: configuredExternalSchemas } = options;
  let externalSchemas = configuredExternalSchemas;
  let resolveMetaSchema: JsonSchemaMetaSchemaResolver | undefined = undefined;
  const declaredDialect = declaredJsonSchemaDialect(parsed.value.value.schema);
  if (declaredDialect.uri !== undefined && declaredDialect.dialect === undefined) {
    const normalizedExternalSchemas = normalizeUserExternalSchemaRegistry(externalSchemas);
    if (!normalizedExternalSchemas.ok) return normalizedExternalSchemas;
    externalSchemas = normalizedExternalSchemas.value;
    const dialectGraph = buildJsonSchemaResourceGraph({
      dialect: options.dialect ?? "draft-2020-12",
      externalSchemas,
      ...(rootRetrievalUri === undefined ? {} : { rootRetrievalUri }),
      schema: parsed.value.value.schema,
    });
    if (!dialectGraph.ok) return dialectGraph;
    resolveMetaSchema = createJsonSchemaGraphMetaSchemaResolver(
      externalSchemas,
      dialectGraph.value,
      dialectGraph.value.root,
    );
  }
  const dialect = resolveJsonSchemaDialect(parsed.value.value.schema, options.dialect, {
    externalSchemas,
    locations: parsed.value.locations,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
  });
  if (!dialect.ok) return dialect;

  const vocabulary = resolveJsonSchemaVocabulary(parsed.value.value.schema, dialect.value, {
    externalSchemas,
    locations: parsed.value.locations,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
  });
  if (!vocabulary.ok) return vocabulary;

  const resolvedOptions = { ...options, dialect: dialect.value, externalSchemas };
  const rootPolicy = { dialect: dialect.value, ...vocabulary.value };

  const preflight = preflightJsonSchema({
    locations: parsed.value.locations,
    options: resolvedOptions,
    rootPolicy,
    rootRetrievalUri,
    schema: parsed.value.value.schema,
  });
  if (!preflight.ok) return preflight;

  return mergePreparedDiagnostics(
    {
      applicatorVocabulary: vocabulary.value.applicator,
      dialect: dialect.value,
      formatAssertionVocabulary: vocabulary.value.formatAssertion,
      prepared: parsed.value,
      unevaluatedVocabulary: vocabulary.value.unevaluated,
      validationVocabulary: vocabulary.value.validation,
    },
    parsed,
    dialect,
    vocabulary,
    preflight,
  );
};

export const jsonSchemaInputPlugin: JsonSchemaInputPlugin = {
  kind: jsonSchemaInputPluginKind,
  lower: async (input, options) => {
    await Promise.resolve();
    const resolvedOptions = { ...options, dialect: input.value.dialect };
    const customMetaKeywords =
      options.validator === "none"
        ? validateJsonSchemaCustomMetaKeywords({
            locations: input.locations,
            options: resolvedOptions,
            rootPolicy: {
              applicator: input.value.applicatorVocabulary,
              dialect: input.value.dialect,
              formatAssertion: input.value.formatAssertionVocabulary,
              unevaluated: input.value.unevaluatedVocabulary,
              validation: input.value.validationVocabulary,
            },
            rootRetrievalUri: jsonSchemaDocumentRetrievalUri(input.value),
            schema: input.value.schema,
          })
        : ok(true);
    if (!customMetaKeywords.ok) return customMetaKeywords;
    const lowered = await lowerJsonSchemaDocument(input.value, resolvedOptions, {
      applicatorVocabulary: input.value.applicatorVocabulary,
      formatAssertionVocabulary: input.value.formatAssertionVocabulary,
      locations: input.locations,
      unevaluatedVocabulary: input.value.unevaluatedVocabulary,
      validationVocabulary: input.value.validationVocabulary,
    });
    return appendDiagnostics(lowered, customMetaKeywords.diagnostics ?? []);
  },
  optionsSchema: jsonSchemaInputPluginOptionsSchema,
  prepare: async (document, options) => {
    await Promise.resolve();
    return prepareJsonSchemaDocument(document, options);
  },
};
