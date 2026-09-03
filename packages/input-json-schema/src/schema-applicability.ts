import { isJsonObject } from "./document";
import type { JsonObject, JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./options";

const arrayAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.contains,
  jsonSchemaKeywords.additionalItems,
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.maxContains,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.minContains,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.uniqueItems,
]);

const objectAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.dependentRequired,
  jsonSchemaKeywords.dependentSchemas,
  jsonSchemaKeywords.maxProperties,
  jsonSchemaKeywords.minProperties,
  jsonSchemaKeywords.patternProperties,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.unevaluatedProperties,
]);

const isActiveArrayAssertionKeyword = (schema: JsonObject, keyword: string): boolean =>
  arrayAssertionKeywords.has(keyword) &&
  (keyword !== jsonSchemaKeywords.uniqueItems || schema[jsonSchemaKeywords.uniqueItems] !== false);

export const isDraft7ReferenceSchema = (
  schema: JsonSchemaValue,
  dialect: JsonSchemaDialect,
): boolean =>
  dialect === "draft-7" &&
  isJsonObject(schema) &&
  typeof schema[jsonSchemaKeywords.ref] === "string";

export type JsonSchemaUntypedAssertionKind = "array" | "mixed" | "object";

export const jsonSchemaUntypedAssertionKind = (
  schema: JsonSchemaValue,
): JsonSchemaUntypedAssertionKind | undefined => {
  if (!isJsonObject(schema) || schema[jsonSchemaKeywords.type] !== undefined) return undefined;
  const keywords = Object.keys(schema);
  const hasArrayAssertions = keywords.some((keyword) =>
    isActiveArrayAssertionKeyword(schema, keyword),
  );
  const hasObjectAssertions = keywords.some((keyword) => objectAssertionKeywords.has(keyword));
  if (hasArrayAssertions && hasObjectAssertions) return "mixed";
  if (hasObjectAssertions) return "object";
  return hasArrayAssertions ? "array" : undefined;
};
