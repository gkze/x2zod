import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonPrimitive, jsonStringValues } from "./document";
import type { JsonObject, JsonPrimitive, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords, jsonSchemaMetadataKeywords } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";
import { oneOrIntersection, oneOrUnion } from "./zod-expressions";

type CompositionKeyword =
  | typeof jsonSchemaKeywords.allOf
  | typeof jsonSchemaKeywords.anyOf
  | typeof jsonSchemaKeywords.oneOf;

type CompositionLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{ lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression }>;

type SchemaArrayRequest = Readonly<{
  keyword: CompositionKeyword;
  pointer: JsonPointer;
  values: JsonValue;
}>;

type ObjectSchemaSummary = Readonly<{
  additionalProperties: JsonValue | undefined;
  properties: ReadonlySet<string>;
  required: ReadonlySet<string>;
  schema: JsonObject;
}>;
type FiniteLiterals = ReadonlyMap<string, JsonPrimitive>;

const schemaArrayExpressions = (
  request: SchemaArrayRequest,
  context: CompositionLoweringContext,
): readonly ZodExpression[] | undefined => {
  const { keyword, pointer, values } = request;
  if (!isJsonArray(values)) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: `JSON Schema ${keyword} must be an array of schemas.`,
      pointer,
    });
    return undefined;
  }
  if (values.length === 0) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: `JSON Schema ${keyword} must contain at least one schema.`,
      pointer,
    });
    return undefined;
  }

  const expressions: ZodExpression[] = [];
  for (const [index, schema] of values.entries()) {
    const schemaPointer = jsonSchemaPointerWithSegment(pointer, index);
    if (typeof schema === "boolean" || isJsonObject(schema))
      expressions.push(context.lowerSchema(schemaPointer, schema));
    else
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: `JSON Schema ${keyword} entries must be boolean schemas or schema objects.`,
        pointer: schemaPointer,
      });
  }

  return expressions;
};

const schemaTypeNames = (schema: JsonSchemaValue): ReadonlySet<string> | undefined => {
  if (typeof schema === "boolean") return undefined;
  const type = schema[jsonSchemaKeywords.type];
  if (typeof type === "string") return new Set([type]);
  return isJsonArray(type) ? new Set(jsonStringValues(type)) : undefined;
};

const literalKey = (value: JsonPrimitive): string => `${typeof value}:${JSON.stringify(value)}`;

const finiteLiterals = (schema: JsonSchemaValue): FiniteLiterals | undefined => {
  if (typeof schema === "boolean") return schema ? undefined : new Map();

  const constValue = schema[jsonSchemaKeywords.const];
  if (isJsonPrimitive(constValue)) return new Map([[literalKey(constValue), constValue]]);
  if (constValue !== undefined) return undefined;

  const enumValues = schema[jsonSchemaKeywords.enum];
  if (!isJsonArray(enumValues)) return undefined;

  const literals = new Map<string, JsonPrimitive>();
  for (const value of enumValues) {
    if (!isJsonPrimitive(value)) return undefined;
    literals.set(literalKey(value), value);
  }
  return literals;
};

const setsOverlap = <TValue>(left: ReadonlySet<TValue>, right: ReadonlySet<TValue>): boolean => {
  for (const value of left) if (right.has(value)) return true;
  return false;
};

const literalMapsOverlap = (left: FiniteLiterals, right: FiniteLiterals): boolean => {
  for (const key of left.keys()) if (right.has(key)) return true;
  return false;
};

const disjointSets = <TValue>(
  left: ReadonlySet<TValue> | undefined,
  right: ReadonlySet<TValue> | undefined,
): boolean => left !== undefined && right !== undefined && !setsOverlap(left, right);

const disjointLiteralSets = (
  left: FiniteLiterals | undefined,
  right: FiniteLiterals | undefined,
): boolean => left !== undefined && right !== undefined && !literalMapsOverlap(left, right);

const stringLiteralValues = (schema: JsonSchemaValue): ReadonlySet<string> | undefined => {
  const literals = finiteLiterals(schema);
  if (literals === undefined) return undefined;

  const values = new Set<string>();
  for (const value of literals.values()) {
    if (typeof value !== "string") return undefined;
    values.add(value);
  }
  return values;
};

const objectSchemaSummary = (schema: JsonSchemaValue): ObjectSchemaSummary | undefined => {
  if (!isJsonObject(schema)) return undefined;
  const types = schemaTypeNames(schema);
  if (types !== undefined && !types.has("object")) return undefined;

  const properties = schema[jsonSchemaKeywords.properties];
  const required = schema[jsonSchemaKeywords.required];

  return {
    additionalProperties: schema[jsonSchemaKeywords.additionalProperties],
    properties: new Set(isJsonObject(properties) ? Object.keys(properties) : []),
    required: new Set(isJsonArray(required) ? jsonStringValues(required) : []),
    schema,
  };
};

const propertySchema = (schema: JsonObject, key: string): JsonSchemaValue | undefined => {
  const properties = schema[jsonSchemaKeywords.properties];
  if (!isJsonObject(properties)) return undefined;
  const property = properties[key];
  return typeof property === "boolean" || isJsonObject(property) ? property : undefined;
};

const disjointObjectDiscriminator = (
  left: ObjectSchemaSummary,
  right: ObjectSchemaSummary,
): boolean => {
  for (const key of left.required)
    if (right.required.has(key)) {
      const leftValues = stringLiteralValues(propertySchema(left.schema, key) ?? true);
      const rightValues = stringLiteralValues(propertySchema(right.schema, key) ?? true);
      if (disjointSets(leftValues, rightValues)) return true;
    }

  return false;
};

const disjointObjectRequiredKeys = (
  left: ObjectSchemaSummary,
  right: ObjectSchemaSummary,
): boolean => {
  if (right.additionalProperties === false)
    for (const key of left.required) if (!right.properties.has(key)) return true;
  if (left.additionalProperties === false)
    for (const key of right.required) if (!left.properties.has(key)) return true;

  return false;
};

const disjointObjectSchemas = (left: JsonSchemaValue, right: JsonSchemaValue): boolean => {
  const leftObject = objectSchemaSummary(left);
  const rightObject = objectSchemaSummary(right);
  if (leftObject === undefined || rightObject === undefined) return false;

  return (
    disjointObjectDiscriminator(leftObject, rightObject) ||
    disjointObjectRequiredKeys(leftObject, rightObject)
  );
};

const schemasAreDefinitelyDisjoint = (left: JsonSchemaValue, right: JsonSchemaValue): boolean => {
  if (left === false || right === false) return true;
  if (left === true || right === true) return false;
  if (disjointLiteralSets(finiteLiterals(left), finiteLiterals(right))) return true;
  if (disjointSets(schemaTypeNames(left), schemaTypeNames(right))) return true;
  return disjointObjectSchemas(left, right);
};

const schemasArePairwiseDisjoint = (schemas: readonly JsonSchemaValue[]): boolean => {
  for (const [index, schema] of schemas.entries())
    for (const candidate of schemas.slice(index + 1))
      if (!schemasAreDefinitelyDisjoint(schema, candidate)) return false;

  return true;
};

const schemaArrayValues = (values: JsonValue): readonly JsonSchemaValue[] | undefined => {
  if (!isJsonArray(values)) return undefined;
  const schemas: JsonSchemaValue[] = [];
  for (const value of values) {
    if (typeof value !== "boolean" && !isJsonObject(value)) return undefined;
    schemas.push(value);
  }
  return schemas;
};

const hasOnlyMetadataKeywords = (schema: JsonObject): boolean =>
  Object.keys(schema).every((keyword) => jsonSchemaMetadataKeywords.has(keyword));

export const lowerJsonSchemaAllOf = (
  values: JsonValue,
  pointer: JsonPointer,
  context: CompositionLoweringContext,
): ZodExpression => {
  const expressions = schemaArrayExpressions(
    { keyword: jsonSchemaKeywords.allOf, pointer, values },
    context,
  );
  return expressions === undefined ? zodPlan.unknown() : oneOrIntersection(expressions);
};

export const lowerJsonSchemaAnyOf = (
  values: JsonValue,
  pointer: JsonPointer,
  context: CompositionLoweringContext,
): ZodExpression => {
  const expressions = schemaArrayExpressions(
    { keyword: jsonSchemaKeywords.anyOf, pointer, values },
    context,
  );
  return expressions === undefined ? zodPlan.unknown() : oneOrUnion(expressions);
};

export const lowerJsonSchemaOneOf = (
  values: JsonValue,
  pointer: JsonPointer,
  context: CompositionLoweringContext,
): ZodExpression => {
  const schemas = schemaArrayValues(values);
  if (schemas !== undefined && !schemasArePairwiseDisjoint(schemas))
    context.addDiagnostic({
      code: "unrepresentable_schema_combination",
      message:
        "JSON Schema oneOf can only be lowered when branch exclusivity is statically provable.",
      pointer,
    });

  const expressions = schemaArrayExpressions(
    { keyword: jsonSchemaKeywords.oneOf, pointer, values },
    context,
  );
  return expressions === undefined ? zodPlan.unknown() : oneOrUnion(expressions);
};

export const lowerJsonSchemaNot = (
  schema: JsonValue,
  pointer: JsonPointer,
  context: CompositionLoweringContext,
): ZodExpression => {
  if (schema === true) return zodPlan.never();
  if (schema === false) return zodPlan.unknown();
  if (isJsonObject(schema) && hasOnlyMetadataKeywords(schema)) return zodPlan.never();

  context.addDiagnostic({
    code: "unrepresentable_schema_combination",
    message: "JSON Schema not is only supported for schemas that match every value.",
    pointer,
  });
  return zodPlan.unknown();
};
