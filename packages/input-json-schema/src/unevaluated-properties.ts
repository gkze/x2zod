import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonSchemaValue, jsonStringValues } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords, jsonSchemaMetadataKeywords } from "./metadata";
import { applyJsonSchemaRequiredKeys } from "./object";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { ResolvedJsonSchemaReference } from "./reference";
import { jsonSchemaHasUnsafeObjectBoundary } from "./sibling-assertions";
import { oneOrIntersection, oneOrUnion } from "./zod-expressions";

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
  schema: JsonObject;
  schemaPointer: JsonPointer;
  unevaluatedProperties: JsonSchemaValue;
}>;

type UnevaluatedRequiredCompositionKeyword =
  | typeof jsonSchemaKeywords.anyOf
  | typeof jsonSchemaKeywords.oneOf;

type LowerUnevaluatedRequiredCompositionObjectRequest = Readonly<{
  keyword: UnevaluatedRequiredCompositionKeyword;
  schema: JsonObject;
  schemaPointer: JsonPointer;
  unevaluatedProperties: JsonSchemaValue;
}>;

type LowerMergedObjectRequest = Readonly<{
  context: UnevaluatedPropertiesLoweringContext;
  merged: MergedObject;
  unevaluatedProperties: JsonSchemaValue;
  unevaluatedPropertiesPointer: JsonPointer;
}>;

type AddMergedPropertyRequest = Readonly<{
  context: UnevaluatedPropertiesLoweringContext;
  key: string;
  merged: MergedObject;
  property: MergedObjectProperty;
}>;

type AddMergedPropertiesRequest = Readonly<{
  context: UnevaluatedPropertiesLoweringContext;
  merged: MergedObject;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const mergeableObjectKeywords: ReadonlySet<string> = new Set([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.allOf,
  jsonSchemaKeywords.definitions,
  jsonSchemaKeywords.dollarDefs,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.ref,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.type,
]);

const requiredOnlyBranchKeywords: ReadonlySet<string> = new Set([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.type,
]);

const jsonSchemaTypeNames: ReadonlySet<string> = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

const hasOnlyMergeableObjectKeywords = (schema: JsonObject): boolean =>
  Object.keys(schema).every((keyword) => mergeableObjectKeywords.has(keyword));

const withoutKeywords = (schema: JsonObject, omittedKeywords: ReadonlySet<string>): JsonObject => {
  const result: Record<string, JsonValue> = {};
  for (const [keyword, value] of Object.entries(schema))
    if (!omittedKeywords.has(keyword)) result[keyword] = value;

  return result;
};

const cloneMergedObject = (merged: MergedObject): MergedObject => ({
  properties: new Map(
    [...merged.properties].map(([key, properties]) => [key, [...properties]] as const),
  ),
  required: new Set(merged.required),
});

const allRequiredPropertiesAreDeclared = (merged: MergedObject): boolean =>
  [...merged.required].every((key) => merged.properties.has(key));

const hasValidRequiredKeyword = (schema: JsonObject): boolean => {
  const required = schema[jsonSchemaKeywords.required];
  if (required === undefined) return true;
  if (!isJsonArray(required)) return false;

  const keys = new Set<string>();
  for (const key of required) {
    if (typeof key !== "string" || keys.has(key)) return false;
    keys.add(key);
  }
  return true;
};

const isRequiredOnlyObjectBranch = (schema: JsonValue): schema is JsonObject =>
  isJsonObject(schema) &&
  schemaAllowsObjectsOnly(schema) &&
  hasValidRequiredKeyword(schema) &&
  Object.keys(schema).every((keyword) => requiredOnlyBranchKeywords.has(keyword));

const oneOrXor = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first, second, ...remaining] = expressions;
  if (first === undefined) return zodPlan.never();
  return second === undefined ? first : zodPlan.xor([first, second, ...remaining]);
};

const addMergedProperty = ({
  context,
  key,
  merged,
  property,
}: AddMergedPropertyRequest): boolean => {
  const existing = merged.properties.get(key);
  if (existing === undefined) {
    merged.properties.set(key, [property]);
    return true;
  }
  if (
    [...existing, property].some((candidate) =>
      jsonSchemaHasUnsafeObjectBoundary(candidate.schema, context.resolveReference),
    )
  )
    return false;

  existing.push(property);
  return true;
};

const addMergedProperties = ({
  context,
  merged,
  pointer,
  schema,
}: AddMergedPropertiesRequest): boolean => {
  const properties = schema[jsonSchemaKeywords.properties];
  if (properties === undefined) return true;
  if (!isJsonObject(properties)) return false;

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (typeof propertySchema !== "boolean" && !isJsonObject(propertySchema)) return false;
    if (
      !addMergedProperty({
        context,
        key,
        merged,
        property: {
          pointer: jsonSchemaPointerWithSegment(
            jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.properties),
            key,
          ),
          schema: propertySchema,
        },
      })
    )
      return false;
  }
  return true;
};

const addMergedRequiredKeys = (merged: MergedObject, schema: JsonObject): boolean => {
  const required = schema[jsonSchemaKeywords.required];
  if (required === undefined) return true;
  if (!isJsonArray(required)) return false;
  const seen = new Set<string>();
  for (const key of required) {
    if (typeof key !== "string" || seen.has(key)) return false;
    seen.add(key);
    merged.required.add(key);
  }
  return true;
};

const schemaAllowsObjectsOnly = (schema: JsonObject): boolean => {
  const type = schema[jsonSchemaKeywords.type];
  if (type === undefined || type === "object") return true;
  if (!isJsonArray(type) || type.length === 0) return false;

  const types = jsonStringValues(type);
  return (
    types.length === type.length &&
    new Set(types).size === types.length &&
    types.every((typeName) => jsonSchemaTypeNames.has(typeName)) &&
    types.includes("object")
  );
};

const schemaRequiresObjectsOnly = (schema: JsonSchemaValue, state: ObjectMergeState): boolean => {
  if (!isJsonObject(schema)) return false;
  const type = schema[jsonSchemaKeywords.type];
  if (type === "object" || (isJsonArray(type) && type.length === 1 && type[0] === "object"))
    return true;

  const ref = schema[jsonSchemaKeywords.ref];
  if (typeof ref === "string") {
    const target = state.context.resolveReference(ref);
    if (target !== undefined && !state.visiting.has(target.address)) {
      state.visiting.add(target.address);
      const requiresObjects = schemaRequiresObjectsOnly(target.schema, state);
      state.visiting.delete(target.address);
      if (requiresObjects) return true;
    }
  }

  const allOf = schema[jsonSchemaKeywords.allOf];
  if (!isJsonArray(allOf)) return false;

  return allOf.some(
    (branch) => isJsonSchemaValue(branch) && schemaRequiresObjectsOnly(branch, state),
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
  if (typeof schema[jsonSchemaKeywords.ref] === "string" && !mergeReferenceSchema(schema, state))
    return false;
  if (!schemaAllowsObjectsOnly(schema) || !hasOnlyMergeableObjectKeywords(schema)) return false;
  if (!addMergedProperties({ context: state.context, merged: state.merged, pointer, schema }))
    return false;
  if (!addMergedRequiredKeys(state.merged, schema)) return false;

  const allOf = schema[jsonSchemaKeywords.allOf];
  return (
    allOf === undefined ||
    mergeAllOfObjectSchemas(
      allOf,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.allOf),
      state,
    )
  );
};

const mergedPropertyExpression = (
  properties: readonly MergedObjectProperty[],
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression =>
  oneOrIntersection(
    properties.map((property) => context.lowerSchema(property.pointer, property.schema)),
  );

const undeclaredRequiredPropertyExpression = (
  unevaluatedProperties: JsonSchemaValue,
  unevaluatedPropertiesPointer: JsonPointer,
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression => {
  if (unevaluatedProperties === false) return zodPlan.never();
  if (unevaluatedProperties === true) return zodPlan.unknown();
  return context.lowerSchema(unevaluatedPropertiesPointer, unevaluatedProperties);
};

const lowerMergedObject = (request: LowerMergedObjectRequest): ZodExpression => {
  const { context, merged, unevaluatedProperties, unevaluatedPropertiesPointer } = request;
  const shape: Record<string, ZodExpression> = {};
  for (const [key, properties] of merged.properties) {
    const expression = mergedPropertyExpression(properties, context);
    shape[key] = merged.required.has(key) ? expression : zodPlan.optional(expression);
  }
  for (const key of merged.required)
    shape[key] ??= undeclaredRequiredPropertyExpression(
      unevaluatedProperties,
      unevaluatedPropertiesPointer,
      context,
    );

  const object = applyJsonSchemaRequiredKeys(zodPlan.object(shape), [...merged.required]);
  if (unevaluatedProperties === false) return zodPlan.strict(object);
  if (unevaluatedProperties === true) return zodPlan.passthrough(object);
  return zodPlan.catchall(
    object,
    context.lowerSchema(unevaluatedPropertiesPointer, unevaluatedProperties),
  );
};

export const lowerJsonSchemaUnevaluatedAllOfObject = (
  request: LowerUnevaluatedAllOfObjectRequest,
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression => {
  const merged: MergedObject = { properties: new Map(), required: new Set() };
  const state: ObjectMergeState = { context, merged, visiting: new Set() };
  const unevaluatedPropertiesPointer = jsonSchemaPointerWithSegment(
    request.schemaPointer,
    jsonSchemaKeywords.unevaluatedProperties,
  );
  if (
    schemaRequiresObjectsOnly(request.schema, state) &&
    mergeObjectSchema(
      withoutKeywords(request.schema, new Set([jsonSchemaKeywords.unevaluatedProperties])),
      request.schemaPointer,
      state,
    )
  )
    return lowerMergedObject({
      context,
      merged,
      unevaluatedProperties: request.unevaluatedProperties,
      unevaluatedPropertiesPointer,
    });

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: [
      "JSON Schema allOf with unevaluatedProperties",
      "requires an object-only root and mergeable object schema branches.",
    ].join(" "),
    pointer: unevaluatedPropertiesPointer,
  });
  return zodPlan.unknown();
};

export const lowerJsonSchemaUnevaluatedRequiredCompositionObject = (
  request: LowerUnevaluatedRequiredCompositionObjectRequest,
  context: UnevaluatedPropertiesLoweringContext,
): ZodExpression | undefined => {
  const branches = request.schema[request.keyword];
  if (!isJsonArray(branches) || branches.length === 0 || !hasValidRequiredKeyword(request.schema))
    return undefined;
  const objectBranches: JsonObject[] = [];
  for (const branch of branches) {
    if (!isRequiredOnlyObjectBranch(branch)) return undefined;
    objectBranches.push(branch);
  }

  const merged: MergedObject = { properties: new Map(), required: new Set() };
  const state: ObjectMergeState = { context, merged, visiting: new Set() };
  const rootSchema = withoutKeywords(
    request.schema,
    new Set([request.keyword, jsonSchemaKeywords.unevaluatedProperties]),
  );
  if (
    !schemaRequiresObjectsOnly(request.schema, state) ||
    !mergeObjectSchema(rootSchema, request.schemaPointer, state) ||
    !allRequiredPropertiesAreDeclared(merged)
  )
    return undefined;

  const unevaluatedPropertiesPointer = jsonSchemaPointerWithSegment(
    request.schemaPointer,
    jsonSchemaKeywords.unevaluatedProperties,
  );
  const expressions: ZodExpression[] = [];
  for (const branch of objectBranches) {
    const branchMerged = cloneMergedObject(merged);
    if (!addMergedRequiredKeys(branchMerged, branch)) return undefined;
    if (!allRequiredPropertiesAreDeclared(branchMerged)) return undefined;
    expressions.push(
      lowerMergedObject({
        context,
        merged: branchMerged,
        unevaluatedProperties: request.unevaluatedProperties,
        unevaluatedPropertiesPointer,
      }),
    );
  }

  return request.keyword === jsonSchemaKeywords.anyOf
    ? oneOrUnion(expressions)
    : oneOrXor(expressions);
};
