import { isJsonArray, isJsonObject } from "./document";
import type { JsonObject, JsonValue } from "./document";
import type { JsonSchemaInertKeywordValueType, JsonSchemaInertKeywords } from "./metadata";

export type JsonSchemaValueType = "array" | "boolean" | "null" | "number" | "object" | "string";

export const jsonSchemaValueType = (
  value: JsonValue | undefined,
): JsonSchemaValueType | undefined => {
  if (value === null) return "null";
  if (isJsonArray(value)) return "array";
  if (isJsonObject(value)) return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return undefined;
};

export const configuredInertKeywordValueType = (
  keyword: string,
  inertKeywords: JsonSchemaInertKeywords,
): JsonSchemaInertKeywordValueType | undefined =>
  Object.hasOwn(inertKeywords, keyword) ? inertKeywords[keyword] : undefined;

export const isConfiguredInertKeyword = (
  keyword: string,
  value: JsonValue | undefined,
  inertKeywords: JsonSchemaInertKeywords,
): boolean => {
  const expectedType = configuredInertKeywordValueType(keyword, inertKeywords);
  return expectedType !== undefined && jsonSchemaValueType(value) === expectedType;
};

export const withoutConfiguredInertKeywords = (
  schema: JsonObject,
  inertKeywords: JsonSchemaInertKeywords,
): JsonObject => {
  const entries = Object.entries(schema).filter(
    ([keyword, value]) => !isConfiguredInertKeyword(keyword, value, inertKeywords),
  );
  return entries.length === Object.keys(schema).length ? schema : Object.fromEntries(entries);
};
