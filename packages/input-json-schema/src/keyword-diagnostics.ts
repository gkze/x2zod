import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonSchemaValue } from "./document";
import { configuredInertKeywordValueType, jsonSchemaValueType } from "./inert-keywords";
import {
  jsonSchemaCrossDialectKeywordPolicy,
  jsonSchemaKeywordPolicyForDialect,
  jsonSchemaKeywords,
  jsonSchemaSourceProfileMetadataKeywords,
  jsonSchemaSourceProfileDeclarationKeywords,
  jsonSchemaValidationKeywords,
} from "./metadata";
import type { JsonSchemaDialect, ResolvedJsonSchemaInputPluginOptions } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";

type KeywordDiagnosticsContext = JsonSchemaDiagnosticSink &
  Readonly<{
    dialect?: JsonSchemaDialect | undefined;
    formatAssertionVocabulary?: boolean | undefined;
    options: ResolvedJsonSchemaInputPluginOptions;
    policyForPointer?:
      | ((
          pointer: JsonPointer,
          inherited: Readonly<{
            dialect: JsonSchemaDialect;
            formatAssertion: boolean;
            validation: boolean;
          }>,
        ) => Readonly<{
          dialect: JsonSchemaDialect;
          formatAssertion: boolean;
          validation: boolean;
        }>)
      | undefined;
    validationVocabulary?: boolean | undefined;
  }>;

type EffectiveKeywordPolicy = Readonly<{
  dialect: JsonSchemaDialect;
  formatAssertion: boolean;
  validation: boolean;
}>;

const effectivePolicy = (
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): EffectiveKeywordPolicy => {
  const inherited = {
    dialect: context.dialect ?? context.options.dialect,
    formatAssertion: context.formatAssertionVocabulary ?? false,
    validation: context.validationVocabulary ?? true,
  } satisfies EffectiveKeywordPolicy;
  return context.policyForPointer?.(pointer, inherited) ?? inherited;
};

const allowProfileKeyword = (
  key: string,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): boolean => {
  const declaration =
    jsonSchemaSourceProfileDeclarationKeywords[context.options.sourceProfile].has(key);
  if (
    !declaration &&
    !jsonSchemaSourceProfileMetadataKeywords[context.options.sourceProfile].has(key)
  )
    return false;
  context.addDiagnostic({
    code: "json-schema/ignored-keyword",
    message: `${context.options.sourceProfile} source profile accepts nonstandard ${key} as ${declaration ? "a compatibility declaration container" : "compatibility metadata"}.`,
    pointer,
    severity: "warning",
  });
  return true;
};

type ConfiguredInertKeywordRequest = Readonly<{
  context: KeywordDiagnosticsContext;
  key: string;
  pointer: JsonPointer;
  schema: Exclude<JsonSchemaValue, boolean>;
}>;

const allowConfiguredInertKeyword = ({
  context,
  key,
  pointer,
  schema,
}: ConfiguredInertKeywordRequest): boolean => {
  const expectedType = configuredInertKeywordValueType(key, context.options.inertKeywords);
  if (expectedType === undefined) return false;

  const actualType = jsonSchemaValueType(schema[key]);
  if (actualType !== expectedType) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: `Configured inert keyword ${key} must have a ${expectedType} value; received ${actualType ?? "an invalid JSON"} value.`,
      pointer,
    });
    return true;
  }

  context.addDiagnostic({
    code: "json-schema/ignored-keyword",
    message: `Configured keyword ${key} is accepted as validation-inert metadata.`,
    pointer,
    severity: "warning",
  });
  return true;
};

const allowUnknownKeywordPolicy = (
  key: string,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): boolean => {
  if (key.startsWith("$")) return false;
  if (jsonSchemaCrossDialectKeywordPolicy(key) !== "unknown") return false;
  const policy = context.options.unknownKeywords;
  if (policy === "ignore") return true;
  if (policy === "reject") return false;

  context.addDiagnostic({
    code: "json-schema/ignored-keyword",
    message: `Unknown keyword ${key} is accepted as a validation-inert vendor extension.`,
    pointer,
    severity: "warning",
  });
  return true;
};

export const collectKeywordDiagnostics = (
  schema: JsonSchemaValue,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): void => {
  if (typeof schema === "boolean") return;

  const policy = effectivePolicy(pointer, context);
  const effectiveContext: KeywordDiagnosticsContext = {
    ...context,
    dialect: policy.dialect,
    formatAssertionVocabulary: policy.formatAssertion,
    validationVocabulary: policy.validation,
  };

  for (const key of Object.keys(schema)) {
    const keyPointer = jsonSchemaPointerWithSegment(pointer, key);
    if (key === jsonSchemaKeywords.format && policy.formatAssertion) {
      const format = schema[key];
      context.addDiagnostic({
        code:
          typeof format === "string" ? "json-schema/unsupported-format" : "invalid_schema_document",
        message:
          typeof format === "string"
            ? `JSON Schema format assertion is required but no active format profile implements: ${format}.`
            : "JSON Schema format must be a string when format assertion is required.",
        pointer: keyPointer,
      });
    } else if (policy.validation || !jsonSchemaValidationKeywords.has(key)) {
      const keywordPolicy = jsonSchemaKeywordPolicyForDialect(key, policy.dialect);
      if (
        keywordPolicy !== "supported" &&
        !allowConfiguredInertKeyword({
          context: effectiveContext,
          key,
          pointer: keyPointer,
          schema,
        }) &&
        !allowProfileKeyword(key, keyPointer, effectiveContext) &&
        !allowUnknownKeywordPolicy(key, keyPointer, effectiveContext)
      )
        context.addDiagnostic({
          code: "unknown_keyword",
          message: `JSON Schema keyword is not recognized by the selected source profile: ${key}.`,
          pointer: keyPointer,
        });
    }
  }
};
