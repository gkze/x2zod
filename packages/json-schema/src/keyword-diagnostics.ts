import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywordPolicy } from "./keyword-policy";
import { jsonSchemaKeywords, opencodeSourceProfileMetadataKeywords } from "./metadata";
import type { JsonSchemaInputPluginOptions } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";

type KeywordDiagnosticsContext = JsonSchemaDiagnosticSink &
  Readonly<{ options: JsonSchemaInputPluginOptions }>;

const allowProfileKeyword = (
  key: string,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): boolean => {
  if (
    context.options.sourceProfile !== "opencode" ||
    !opencodeSourceProfileMetadataKeywords.has(key)
  )
    return false;
  context.addDiagnostic({
    code: "json-schema/ignored-keyword",
    message: `OpenCode source profile treats nonstandard ${key} as inert metadata.`,
    pointer,
    severity: "warning",
  });
  return true;
};

const collectSchemaMapDiagnostics = (
  value: JsonValue | undefined,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): void => {
  if (!isJsonObject(value)) return;
  for (const [key, schema] of Object.entries(value))
    if (isJsonSchemaValue(schema))
      collectKeywordDiagnostics(schema, jsonSchemaPointerWithSegment(pointer, key), context);
};

const collectChildSchemaDiagnostics = (
  value: JsonValue | undefined,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): void => {
  if (isJsonArray(value)) {
    context.addDiagnostic({
      code: "unsupported_keyword",
      message: "Tuple schemas are not supported in the first JSON Schema lowering slice.",
      pointer,
    });
    return;
  }
  if (isJsonSchemaValue(value)) collectKeywordDiagnostics(value, pointer, context);
};

const collectSchemaArrayDiagnostics = (
  value: JsonValue | undefined,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): void => {
  if (!isJsonArray(value)) return;
  for (const [index, schema] of value.entries())
    if (isJsonSchemaValue(schema))
      collectKeywordDiagnostics(schema, jsonSchemaPointerWithSegment(pointer, index), context);
};

export const collectKeywordDiagnostics = (
  schema: JsonSchemaValue,
  pointer: JsonPointer,
  context: KeywordDiagnosticsContext,
): void => {
  if (typeof schema === "boolean") return;

  for (const key of Object.keys(schema)) {
    const keyPointer = jsonSchemaPointerWithSegment(pointer, key);
    const keywordPolicy = jsonSchemaKeywordPolicy(key);
    if (keywordPolicy !== "supported" && !allowProfileKeyword(key, keyPointer, context))
      context.addDiagnostic({
        code: keywordPolicy === "unsupported" ? "unsupported_keyword" : "unknown_keyword",
        message:
          keywordPolicy === "unsupported"
            ? `JSON Schema keyword is recognized but not supported in the first lowering slice: ${key}.`
            : `JSON Schema keyword is not recognized by the selected source profile: ${key}.`,
        pointer: keyPointer,
      });
  }

  collectSchemaMapDiagnostics(
    schema[jsonSchemaKeywords.dollarDefs],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.dollarDefs),
    context,
  );
  collectSchemaMapDiagnostics(
    schema[jsonSchemaKeywords.definitions],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.definitions),
    context,
  );
  collectSchemaMapDiagnostics(
    schema[jsonSchemaKeywords.properties],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.properties),
    context,
  );
  collectChildSchemaDiagnostics(
    schema[jsonSchemaKeywords.items],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.items),
    context,
  );
  collectSchemaArrayDiagnostics(
    schema[jsonSchemaKeywords.prefixItems],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.prefixItems),
    context,
  );
  collectChildSchemaDiagnostics(
    schema[jsonSchemaKeywords.additionalProperties],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.additionalProperties),
    context,
  );
  collectSchemaArrayDiagnostics(
    schema[jsonSchemaKeywords.anyOf],
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.anyOf),
    context,
  );
};
