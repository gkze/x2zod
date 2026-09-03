import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result, SourceLocationMap } from "@x2zod/core";

import { jsonSchemaDiagnosticLocation } from "./diagnostics";
import { isJsonObject, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue } from "./document";
import { resolveExternalSchemaRegistryDocument } from "./external-schema-registry";
import { jsonSchemaDialectForSchemaUri } from "./meta-schemas";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaInputPluginOptions } from "./options";

const schemaPointer = jsonPointerFromPath([jsonSchemaKeywords.schema]);

type ModernJsonSchemaDialect = Exclude<JsonSchemaDialect, "draft-7">;

const vocabularyUris = {
  "draft-2019-09": {
    applicator: "https://json-schema.org/draft/2019-09/vocab/applicator",
    content: "https://json-schema.org/draft/2019-09/vocab/content",
    core: "https://json-schema.org/draft/2019-09/vocab/core",
    formatAssertion: "https://json-schema.org/draft/2019-09/vocab/format",
    metadata: "https://json-schema.org/draft/2019-09/vocab/meta-data",
    unevaluated: "https://json-schema.org/draft/2019-09/vocab/unevaluated",
    validation: "https://json-schema.org/draft/2019-09/vocab/validation",
  },
  "draft-2020-12": {
    applicator: "https://json-schema.org/draft/2020-12/vocab/applicator",
    content: "https://json-schema.org/draft/2020-12/vocab/content",
    core: "https://json-schema.org/draft/2020-12/vocab/core",
    formatAnnotation: "https://json-schema.org/draft/2020-12/vocab/format-annotation",
    formatAssertion: "https://json-schema.org/draft/2020-12/vocab/format-assertion",
    metadata: "https://json-schema.org/draft/2020-12/vocab/meta-data",
    unevaluated: "https://json-schema.org/draft/2020-12/vocab/unevaluated",
    validation: "https://json-schema.org/draft/2020-12/vocab/validation",
  },
} as const satisfies Readonly<Record<ModernJsonSchemaDialect, Readonly<Record<string, string>>>>;

const commonApplicatorKeywords = [
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.allOf,
  jsonSchemaKeywords.anyOf,
  jsonSchemaKeywords.contains,
  jsonSchemaKeywords.dependentSchemas,
  jsonSchemaKeywords.else,
  jsonSchemaKeywords.if,
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.not,
  jsonSchemaKeywords.oneOf,
  jsonSchemaKeywords.patternProperties,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.thenKeyword,
] as const;

const applicatorKeywords: Readonly<Record<ModernJsonSchemaDialect, ReadonlySet<string>>> = {
  "draft-2019-09": new Set([...commonApplicatorKeywords, jsonSchemaKeywords.additionalItems]),
  "draft-2020-12": new Set([...commonApplicatorKeywords, jsonSchemaKeywords.prefixItems]),
};

const unevaluatedKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.unevaluatedProperties,
]);

const supportedVocabularyUris: Readonly<Record<ModernJsonSchemaDialect, ReadonlySet<string>>> = {
  "draft-2019-09": new Set(Object.values(vocabularyUris["draft-2019-09"])),
  "draft-2020-12": new Set(Object.values(vocabularyUris["draft-2020-12"])),
};

export const declaredJsonSchemaDialect = (
  schema: JsonSchemaValue,
): Readonly<{ dialect?: JsonSchemaDialect; uri?: string }> => {
  if (!isJsonObject(schema)) return {};
  const schemaUri = schema[jsonSchemaKeywords.schema];
  if (typeof schemaUri !== "string") return {};
  const dialect = jsonSchemaDialectForSchemaUri(schemaUri);
  return dialect === undefined ? { uri: schemaUri } : { dialect, uri: schemaUri };
};

export type JsonSchemaMetaSchemaResolver = (
  reference: string,
) => Result<JsonSchemaValue | undefined>;

const resolveMetaSchemaValue = (
  reference: string,
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"],
  resolveMetaSchema?: JsonSchemaMetaSchemaResolver,
): Result<JsonSchemaValue | undefined> => {
  if (resolveMetaSchema !== undefined) return resolveMetaSchema(reference);
  const resolved = resolveExternalSchemaRegistryDocument(externalSchemas, reference);
  return resolved.ok ? ok(resolved.value?.schema) : resolved;
};

type InferDialectOptions = Readonly<{
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  resolveMetaSchema?: JsonSchemaMetaSchemaResolver | undefined;
  seen?: ReadonlySet<string> | undefined;
}>;

const inferredDialect = (
  schema: JsonSchemaValue,
  { externalSchemas, resolveMetaSchema, seen = new Set() }: InferDialectOptions,
): Result<JsonSchemaDialect | null> => {
  const declared = declaredJsonSchemaDialect(schema);
  if (declared.dialect !== undefined) return ok(declared.dialect);
  if (declared.uri === undefined || seen.has(declared.uri)) return ok(null);
  const metaschema = resolveMetaSchemaValue(declared.uri, externalSchemas, resolveMetaSchema);
  if (!metaschema.ok) return metaschema;
  if (metaschema.value === undefined) return ok(null);
  return inferredDialect(metaschema.value, {
    externalSchemas,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
    seen: new Set([...seen, declared.uri]),
  });
};

export type JsonSchemaVocabularyPolicy = Readonly<{
  applicator: boolean;
  formatAssertion: boolean;
  unevaluated: boolean;
  validation: boolean;
}>;

export type JsonSchemaDialectPolicy = JsonSchemaVocabularyPolicy &
  Readonly<{ dialect: JsonSchemaDialect }>;

const defaultVocabularyPolicy: JsonSchemaVocabularyPolicy = {
  applicator: true,
  formatAssertion: false,
  unevaluated: true,
  validation: true,
};

export const defaultJsonSchemaDialectPolicy = (
  dialect: JsonSchemaDialect,
): JsonSchemaDialectPolicy => ({ dialect, ...defaultVocabularyPolicy });

type ResolveJsonSchemaVocabularyOptions = Readonly<{
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  locations?: SourceLocationMap | undefined;
  resolveMetaSchema?: JsonSchemaMetaSchemaResolver | undefined;
}>;

const unsupportedVocabulary = (
  uri: string,
  locations?: SourceLocationMap,
  message = `JSON Schema required vocabulary is not supported: ${uri}.`,
): Result<JsonSchemaVocabularyPolicy> =>
  err(
    createDiagnostic({
      code: "unsupported_vocabulary",
      location: jsonSchemaDiagnosticLocation(schemaPointer, locations),
      message,
    }),
  );

type ResolveSupportedDeclaredDialectRequest = ResolveJsonSchemaVocabularyOptions &
  Readonly<{
    declaredDialect?: JsonSchemaDialect | undefined;
    declaredUri: string;
    schema: JsonSchemaValue;
  }>;

const resolveSupportedDeclaredDialect = ({
  declaredDialect,
  declaredUri,
  externalSchemas,
  locations,
  resolveMetaSchema,
  schema,
}: ResolveSupportedDeclaredDialectRequest): Result<JsonSchemaDialect> => {
  const inferred = inferredDialect(schema, {
    externalSchemas,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
  });
  if (!inferred.ok) return inferred;
  const dialect = declaredDialect ?? inferred.value;
  return dialect === null
    ? err(
        createDiagnostic({
          code: "unsupported_dialect",
          location: jsonSchemaDiagnosticLocation(schemaPointer, locations),
          message: `JSON Schema dialect is not supported: ${declaredUri}.`,
        }),
      )
    : ok(dialect);
};

export const resolveJsonSchemaVocabulary = (
  schema: JsonSchemaValue,
  dialect: JsonSchemaDialect,
  { externalSchemas, locations, resolveMetaSchema }: ResolveJsonSchemaVocabularyOptions,
): Result<JsonSchemaVocabularyPolicy> => {
  const declared = declaredJsonSchemaDialect(schema);
  if (declared.uri === undefined || declared.dialect !== undefined || dialect === "draft-7")
    return ok(defaultVocabularyPolicy);
  const resolvedMetaschema = resolveMetaSchemaValue(
    declared.uri,
    externalSchemas,
    resolveMetaSchema,
  );
  if (!resolvedMetaschema.ok) return resolvedMetaschema;
  const metaschema = resolvedMetaschema.value;
  if (metaschema === undefined || !isJsonObject(metaschema)) return ok(defaultVocabularyPolicy);

  const vocabulary = metaschema[jsonSchemaKeywords.vocabulary];
  if (!isJsonObject(vocabulary)) return ok(defaultVocabularyPolicy);
  const dialectVocabularyUris = vocabularyUris[dialect];
  const coreUri = dialectVocabularyUris.core;
  if (vocabulary[coreUri] !== true)
    return unsupportedVocabulary(
      coreUri,
      locations,
      `JSON Schema custom dialect must declare its core vocabulary as required: ${coreUri}.`,
    );
  for (const [uri, required] of Object.entries(vocabulary))
    if (required === true && !supportedVocabularyUris[dialect].has(uri))
      return unsupportedVocabulary(uri, locations);

  return ok({
    applicator: Object.hasOwn(vocabulary, dialectVocabularyUris.applicator),
    formatAssertion: vocabulary[dialectVocabularyUris.formatAssertion] === true,
    unevaluated: Object.hasOwn(vocabulary, dialectVocabularyUris.unevaluated),
    validation: Object.hasOwn(vocabulary, dialectVocabularyUris.validation),
  });
};

export const validateJsonSchemaVocabularyUsage = (
  schema: JsonSchemaValue,
  policy: JsonSchemaDialectPolicy,
): Result<null> => {
  if (!isJsonObject(schema) || policy.dialect === "draft-7") return ok(null);
  const requirements = [
    {
      active: policy.applicator,
      keywords: applicatorKeywords[policy.dialect],
      uri: vocabularyUris[policy.dialect].applicator,
    },
    {
      active: policy.unevaluated,
      keywords: unevaluatedKeywords,
      uri: vocabularyUris[policy.dialect].unevaluated,
    },
  ] as const;
  for (const { active, keywords, uri } of requirements) {
    const keyword = active
      ? undefined
      : Object.keys(schema).find((candidate) => keywords.has(candidate));
    if (keyword !== undefined)
      return err(
        createDiagnostic({
          code: "unsupported_vocabulary",
          location: jsonSchemaDiagnosticLocation(jsonPointerFromPath([keyword])),
          message: `JSON Schema keyword ${keyword} requires the declared ${uri} vocabulary.`,
        }),
      );
  }
  return ok(null);
};

export const resolveJsonSchemaDialectPolicy = (
  schema: JsonSchemaValue,
  inheritedPolicy: JsonSchemaDialectPolicy,
  {
    externalSchemas,
    resolveMetaSchema,
  }: Readonly<{
    externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
    resolveMetaSchema?: JsonSchemaMetaSchemaResolver | undefined;
  }>,
): Result<JsonSchemaDialectPolicy> => {
  const declared = declaredJsonSchemaDialect(schema);
  if (declared.uri === undefined) return ok(inheritedPolicy);
  const resolvedDialect = resolveSupportedDeclaredDialect({
    declaredDialect: declared.dialect,
    declaredUri: declared.uri,
    externalSchemas,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
    schema,
  });
  if (!resolvedDialect.ok) return resolvedDialect;
  const dialect = resolvedDialect.value;
  const vocabulary = resolveJsonSchemaVocabulary(schema, dialect, {
    externalSchemas,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
  });
  return vocabulary.ok ? ok({ dialect, ...vocabulary.value }) : vocabulary;
};

export const resolveJsonSchemaDialect = (
  schema: JsonSchemaValue,
  requestedDialect: JsonSchemaDialect | undefined,
  options: Readonly<{
    externalSchemas?: JsonSchemaInputPluginOptions["externalSchemas"] | undefined;
    locations?: SourceLocationMap | undefined;
    resolveMetaSchema?: JsonSchemaMetaSchemaResolver | undefined;
  }> = {},
): Result<JsonSchemaDialect> => {
  const { externalSchemas = {}, locations, resolveMetaSchema } = options;
  const declared = declaredJsonSchemaDialect(schema);
  if (declared.uri === undefined) return ok(requestedDialect ?? "draft-2020-12");
  const resolvedDialect = resolveSupportedDeclaredDialect({
    declaredDialect: declared.dialect,
    declaredUri: declared.uri,
    externalSchemas,
    ...(locations === undefined ? {} : { locations }),
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
    schema,
  });
  if (!resolvedDialect.ok) return resolvedDialect;
  const dialect = resolvedDialect.value;
  if (requestedDialect !== undefined && dialect !== requestedDialect)
    return err(
      createDiagnostic({
        code: "dialect_conflict",
        location: jsonSchemaDiagnosticLocation(schemaPointer, locations),
        message: `JSON Schema declares dialect ${dialect} but plugin options requested ${requestedDialect}.`,
      }),
    );

  return ok(dialect);
};
