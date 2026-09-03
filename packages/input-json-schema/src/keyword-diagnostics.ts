import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonSchemaValue } from "./document";
import {
  jsonSchemaKeywordPolicyForDialect,
  jsonSchemaKeywords,
  jsonSchemaSourceProfileMetadataKeywords,
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
  if (!jsonSchemaSourceProfileMetadataKeywords[context.options.sourceProfile].has(key))
    return false;
  context.addDiagnostic({
    code: "json-schema/ignored-keyword",
    message: `${context.options.sourceProfile} source profile accepts nonstandard ${key} as compatibility metadata.`,
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
      if (keywordPolicy !== "supported" && !allowProfileKeyword(key, keyPointer, effectiveContext))
        context.addDiagnostic({
          code: "unknown_keyword",
          message: `JSON Schema keyword is not recognized by the selected source profile: ${key}.`,
          pointer: keyPointer,
        });
    }
  }
};
