import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonPrimitive, jsonStringValues } from "./document";
import type { JsonObject, JsonValue } from "./document";
import {
  jsonSchemaAnyOfAllowedSiblingKeywords,
  jsonSchemaKeywords,
  opencodeModelRef,
  opencodeSourceProfileMetadataKeywords,
} from "./metadata";
import type { JsonSchemaSourceProfile } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";

type SiblingAssertionContext = JsonSchemaDiagnosticSink &
  Readonly<{ sourceProfile: JsonSchemaSourceProfile }>;

type SiblingAssertionRequest = Readonly<{
  keyword: string;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const jsonSchemaTypeForLiteral = (value: boolean | null | number | string): string => {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  return typeof value;
};

const schemaTypeNames = (schema: JsonObject): readonly string[] => {
  const type = schema[jsonSchemaKeywords.type];
  if (typeof type === "string") return [type];
  return isJsonArray(type) ? jsonStringValues(type) : [];
};

const typeAllowsLiteralValue = (types: readonly string[], value: JsonValue): boolean =>
  isJsonPrimitive(value) && types.includes(jsonSchemaTypeForLiteral(value));

const isRedundantTypeForEnum = (schema: JsonObject): boolean => {
  const types = schemaTypeNames(schema);
  const values = schema[jsonSchemaKeywords.enum];
  return (
    types.length > 0 &&
    isJsonArray(values) &&
    values.every((value) => typeAllowsLiteralValue(types, value))
  );
};

const isRedundantTypeForConst = (schema: JsonObject): boolean => {
  const types = schemaTypeNames(schema);
  const value = schema[jsonSchemaKeywords.const];
  return types.length > 0 && value !== undefined && typeAllowsLiteralValue(types, value);
};

const isOpenCodeModelRefTypeSibling = (
  schema: JsonObject,
  context: SiblingAssertionContext,
): boolean =>
  context.sourceProfile === "opencode" &&
  schema[jsonSchemaKeywords.ref] === opencodeModelRef &&
  schema[jsonSchemaKeywords.type] === "string";

const allowsTypeSibling = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  if (request.keyword === jsonSchemaKeywords.enum) return isRedundantTypeForEnum(request.schema);
  if (request.keyword === jsonSchemaKeywords.const) return isRedundantTypeForConst(request.schema);
  if (request.keyword === jsonSchemaKeywords.ref)
    return isOpenCodeModelRefTypeSibling(request.schema, context);
  return false;
};

const isMetadataSiblingKeyword = (key: string, context: SiblingAssertionContext): boolean =>
  jsonSchemaAnyOfAllowedSiblingKeywords.has(key) ||
  (context.sourceProfile === "opencode" && opencodeSourceProfileMetadataKeywords.has(key));

const isSupportedUnevaluatedPropertiesSibling = (
  key: string,
  request: SiblingAssertionRequest,
): boolean =>
  request.keyword === jsonSchemaKeywords.allOf &&
  key === jsonSchemaKeywords.unevaluatedProperties &&
  typeof request.schema[jsonSchemaKeywords.unevaluatedProperties] === "boolean";

const isAllowedSiblingKeyword = (
  key: string,
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean =>
  key === request.keyword ||
  isMetadataSiblingKeyword(key, context) ||
  isSupportedUnevaluatedPropertiesSibling(key, request) ||
  (allowsTypeSibling(request, context) && key === jsonSchemaKeywords.type);

export const hasUnsupportedSiblingAssertions = (
  request: SiblingAssertionRequest,
  context: SiblingAssertionContext,
): boolean => {
  const { keyword, pointer, schema } = request;
  if (Object.keys(schema).every((key) => isAllowedSiblingKeyword(key, request, context)))
    return false;

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: `JSON Schema ${keyword} with sibling assertion keywords is not supported by this lowering slice.`,
    pointer: jsonSchemaPointerWithSegment(pointer, keyword),
  });
  return true;
};
