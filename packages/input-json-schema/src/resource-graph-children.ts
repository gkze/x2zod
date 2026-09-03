import type { JsonPointer } from "@x2zod/core";

import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";
import { isDraft7ReferenceSchema } from "./schema-applicability";

export type JsonSchemaChildKeywordDescriptor = Readonly<{
  keyword: string;
  role: "applicator" | "content" | "declaration";
  shape: "array" | "direct" | "direct-or-array" | "map";
}>;
type ResourceGraphChildSchema = Readonly<{ pointer: JsonPointer; schema: JsonSchemaValue }>;

const descriptor = (
  keyword: string,
  shape: JsonSchemaChildKeywordDescriptor["shape"],
  role: JsonSchemaChildKeywordDescriptor["role"] = "applicator",
): JsonSchemaChildKeywordDescriptor => ({ keyword, role, shape });

const commonMaps = [
  descriptor(jsonSchemaKeywords.patternProperties, "map"),
  descriptor(jsonSchemaKeywords.properties, "map"),
] as const;
const commonArrays = [
  descriptor(jsonSchemaKeywords.allOf, "array"),
  descriptor(jsonSchemaKeywords.anyOf, "array"),
  descriptor(jsonSchemaKeywords.oneOf, "array"),
] as const;
const commonDirect = [
  descriptor(jsonSchemaKeywords.additionalProperties, "direct"),
  descriptor(jsonSchemaKeywords.contains, "direct"),
  descriptor(jsonSchemaKeywords.else, "direct"),
  descriptor(jsonSchemaKeywords.if, "direct"),
  descriptor(jsonSchemaKeywords.not, "direct"),
  descriptor(jsonSchemaKeywords.propertyNames, "direct"),
  descriptor(jsonSchemaKeywords.thenKeyword, "direct"),
] as const;
const modernDirect = [
  descriptor(jsonSchemaKeywords.contentSchema, "direct", "content"),
  descriptor(jsonSchemaKeywords.unevaluatedItems, "direct"),
  descriptor(jsonSchemaKeywords.unevaluatedProperties, "direct"),
] as const;

const descriptorsByDialect = {
  "draft-7": [
    descriptor(jsonSchemaKeywords.definitions, "map", "declaration"),
    ...commonMaps,
    ...commonArrays,
    ...commonDirect,
    descriptor(jsonSchemaKeywords.additionalItems, "direct"),
    descriptor(jsonSchemaKeywords.items, "direct-or-array"),
    descriptor(jsonSchemaKeywords.dependencies, "map"),
  ],
  "draft-2019-09": [
    descriptor(jsonSchemaKeywords.dollarDefs, "map", "declaration"),
    ...commonMaps,
    descriptor(jsonSchemaKeywords.dependentSchemas, "map"),
    ...commonArrays,
    ...commonDirect,
    ...modernDirect,
    descriptor(jsonSchemaKeywords.additionalItems, "direct"),
    descriptor(jsonSchemaKeywords.items, "direct-or-array"),
  ],
  "draft-2020-12": [
    descriptor(jsonSchemaKeywords.dollarDefs, "map", "declaration"),
    ...commonMaps,
    descriptor(jsonSchemaKeywords.dependentSchemas, "map"),
    ...commonArrays,
    ...commonDirect,
    ...modernDirect,
    descriptor(jsonSchemaKeywords.items, "direct"),
    descriptor(jsonSchemaKeywords.prefixItems, "array"),
  ],
} as const satisfies Readonly<
  Record<JsonSchemaDialect, readonly JsonSchemaChildKeywordDescriptor[]>
>;

const dialectSchemaChildKeywordDescriptors = (
  dialect: JsonSchemaDialect,
): readonly JsonSchemaChildKeywordDescriptor[] => descriptorsByDialect[dialect];

export const dialectSchemaChildKeywordDescriptor = (
  dialect: JsonSchemaDialect,
  keyword: string,
): JsonSchemaChildKeywordDescriptor | undefined =>
  dialectSchemaChildKeywordDescriptors(dialect).find((candidate) => candidate.keyword === keyword);

const isSchemaValue = (value: JsonValue | undefined): value is JsonSchemaValue =>
  isJsonSchemaValue(value);

const childSchemas = (
  schema: JsonObject,
  pointer: JsonPointer,
  child: JsonSchemaChildKeywordDescriptor,
): readonly ResourceGraphChildSchema[] => {
  const value = schema[child.keyword];
  const childPointer = jsonSchemaPointerWithSegment(pointer, child.keyword);
  if (child.shape === "map" && isJsonObject(value))
    return Object.entries(value).flatMap(([key, nested]) =>
      isSchemaValue(nested)
        ? [{ pointer: jsonSchemaPointerWithSegment(childPointer, key), schema: nested }]
        : [],
    );
  if ((child.shape === "array" || child.shape === "direct-or-array") && isJsonArray(value))
    return value.flatMap((nested, index) =>
      isSchemaValue(nested)
        ? [{ pointer: jsonSchemaPointerWithSegment(childPointer, index), schema: nested }]
        : [],
    );
  return (child.shape === "direct" || child.shape === "direct-or-array") && isSchemaValue(value)
    ? [{ pointer: childPointer, schema: value }]
    : [];
};

type DialectSchemaChildrenRequest = Readonly<{
  dialect: JsonSchemaDialect;
  pointer: JsonPointer;
  roles?: ReadonlySet<JsonSchemaChildKeywordDescriptor["role"]> | undefined;
  schema: JsonObject;
}>;

const dialectSchemaChildrenInternal = ({
  dialect,
  pointer,
  roles,
  schema,
}: DialectSchemaChildrenRequest): readonly ResourceGraphChildSchema[] =>
  dialectSchemaChildKeywordDescriptors(dialect).flatMap((child) =>
    roles === undefined || roles.has(child.role) ? childSchemas(schema, pointer, child) : [],
  );

const appliedRoles = new Set<JsonSchemaChildKeywordDescriptor["role"]>(["applicator"]);

export const dialectSchemaChildren = (
  schema: JsonObject,
  pointer: JsonPointer,
  dialect: JsonSchemaDialect,
): readonly ResourceGraphChildSchema[] =>
  dialectSchemaChildrenInternal({ dialect, pointer, schema });

export const dialectAppliedSchemaChildren = (
  schema: JsonObject,
  pointer: JsonPointer,
  dialect: JsonSchemaDialect,
): readonly ResourceGraphChildSchema[] =>
  isDraft7ReferenceSchema(schema, dialect)
    ? []
    : dialectSchemaChildrenInternal({ dialect, pointer, roles: appliedRoles, schema });

export const dialectRuntimeSchemaChildren: typeof dialectAppliedSchemaChildren =
  dialectAppliedSchemaChildren;
