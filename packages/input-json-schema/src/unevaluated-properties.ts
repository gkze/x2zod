import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, jsonStringValues } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { applyJsonSchemaRequiredKeys } from "./object";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { ResolvedJsonSchemaReference } from "./reference";
import { oneOrIntersection } from "./zod-expressions";

type MergedObjectProperty = Readonly<{ pointer: JsonPointer; schema: JsonSchemaValue }>;

type MergedObject = Readonly<{
  properties: Map<string, MergedObjectProperty[]>;
  required: Set<string>;
}>;

type UnevaluatedPropertiesLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{
    lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression;
    resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
  }>;

type ObjectMergeState = Readonly<{
  context: UnevaluatedPropertiesLoweringContext;
  merged: MergedObject;
  visiting: Set<string>;
}>;

type LowerUnevaluatedAllOfObjectRequest = Readonly<{
  allOfPointer: JsonPointer;
  schemaPointer: JsonPointer;
  values: JsonValue;
}>;

const hasArbitraryEvaluatedProperties = (schema: JsonObject): boolean => {
  const additionalProperties = schema[jsonSchemaKeywords.additionalProperties];
  return additionalProperties !== undefined && additionalProperties !== false;
};

const addMergedProperty = (
  merged: MergedObject,
  key: string,
  property: MergedObjectProperty,
): void => {
  const properties = merged.properties.get(key) ?? [];
  properties.push(property);
  merged.properties.set(key, properties);
};

const addMergedProperties = (
  merged: MergedObject,
  schema: JsonObject,
  pointer: JsonPointer,
): boolean => {
  const properties = schema[jsonSchemaKeywords.properties];
  if (properties === undefined) return true;
  if (!isJsonObject(properties)) return false;

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (typeof propertySchema !== "boolean" && !isJsonObject(propertySchema)) return false;
    addMergedProperty(merged, key, {
      pointer: jsonSchemaPointerWithSegment(
        jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.properties),
        key,
      ),
      schema: propertySchema,
    });
  }
  return true;
};

const addMergedRequiredKeys = (merged: MergedObject, schema: JsonObject): boolean => {
  const required = schema[jsonSchemaKeywords.required];
  if (required === undefined) return true;
  if (!isJsonArray(required)) return false;
  for (const key of required) {
    if (typeof key !== "string") return false;
    merged.required.add(key);
  }
  return true;
};

const schemaAllowsObjectsOnly = (schema: JsonObject): boolean => {
  const type = schema[jsonSchemaKeywords.type];
  return (
    type === undefined ||
    type === "object" ||
    (isJsonArray(type) && jsonStringValues(type).includes("object"))
  );
};

const mergeReferenceSchema = (schema: JsonObject, state: ObjectMergeState): boolean => {
  const ref = schema[jsonSchemaKeywords.ref];
  if (typeof ref !== "string") return false;

  const target = state.context.resolveReference(ref);
  if (target === undefined || state.visiting.has(target.address)) return false;
  state.visiting.add(target.address);
  const merged = mergeObjectSchema(target.schema, target.pointer, state);
  state.visiting.delete(target.address);
  return merged;
};

const mergeAllOfObjectSchemas = (
  values: JsonValue,
  pointer: JsonPointer,
  state: ObjectMergeState,
): boolean => {
  if (!isJsonArray(values)) return false;
  for (const [index, schema] of values.entries()) {
    const schemaPointer = jsonSchemaPointerWithSegment(pointer, index);
    if (typeof schema !== "boolean" && !isJsonObject(schema)) return false;
    if (!mergeObjectSchema(schema, schemaPointer, state)) return false;
  }
  return true;
};

const mergeObjectSchema = (
  schema: JsonSchemaValue,
  pointer: JsonPointer,
  state: ObjectMergeState,
): boolean => {
  if (schema === false || schema === true) return false;
  if (typeof schema[jsonSchemaKeywords.ref] === "string")
    return mergeReferenceSchema(schema, state);
  if (!schemaAllowsObjectsOnly(schema) || hasArbitraryEvaluatedProperties(schema)) return false;
  if (!addMergedProperties(state.merged, schema, pointer)) return false;
  if (!addMergedRequiredKeys(state.merged, schema)) return false;

  const allOf = schema[jsonSchemaKeywords.allOf];
  return allOf === undefined || mergeAllOfObjectSchemas(allOf, pointer, state);
};

const mergedPropertyExpression = (
  properties: readonly MergedObjectProperty[],
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression =>
  oneOrIntersection(
    properties.map((property) => context.lowerSchema(property.pointer, property.schema)),
  );

const lowerMergedObject = (
  merged: MergedObject,
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression => {
  const shape: Record<string, ZodExpression> = {};
  for (const [key, properties] of merged.properties) {
    const expression = mergedPropertyExpression(properties, context);
    shape[key] = merged.required.has(key) ? expression : zodPlan.optional(expression);
  }
  for (const key of merged.required) shape[key] ??= zodPlan.unknown();

  return zodPlan.strict(applyJsonSchemaRequiredKeys(zodPlan.object(shape), [...merged.required]));
};

export const lowerJsonSchemaUnevaluatedAllOfObject = (
  request: LowerUnevaluatedAllOfObjectRequest,
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression => {
  const merged: MergedObject = { properties: new Map(), required: new Set() };
  const state: ObjectMergeState = { context, merged, visiting: new Set() };
  if (mergeAllOfObjectSchemas(request.values, request.allOfPointer, state))
    return lowerMergedObject(merged, context);

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      "JSON Schema allOf with unevaluatedProperties:false",
      "requires mergeable object schema branches.",
    ].join(" "),
    pointer: jsonSchemaPointerWithSegment(
      request.schemaPointer,
      jsonSchemaKeywords.unevaluatedProperties,
    ),
  });
  return zodPlan.unknown();
};
