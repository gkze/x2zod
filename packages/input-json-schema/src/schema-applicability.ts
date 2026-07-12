import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";

const arrayAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.prefixItems,
]);

const objectAssertionKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.unevaluatedProperties,
]);

export type JsonSchemaUntypedAssertionKind = "array" | "mixed" | "object";

export const jsonSchemaUntypedAssertionKind = (
  schema: JsonSchemaValue,
): JsonSchemaUntypedAssertionKind | undefined => {
  if (!isJsonObject(schema) || schema[jsonSchemaKeywords.type] !== undefined) return undefined;
  const keywords = Object.keys(schema);
  const hasArrayAssertions = keywords.some((keyword) => arrayAssertionKeywords.has(keyword));
  const hasObjectAssertions = keywords.some((keyword) => objectAssertionKeywords.has(keyword));
  if (hasArrayAssertions && hasObjectAssertions) return "mixed";
  if (hasObjectAssertions) return "object";
  return hasArrayAssertions ? "array" : undefined;
};
