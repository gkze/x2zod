import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";

type ObjectLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{ lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression }>;

type ObjectShapeRequest = Readonly<{
  context: ObjectLoweringContext;
  pointer: JsonPointer;
  required: ReadonlySet<string>;
  schema: JsonObject;
}>;

export const hasJsonSchemaObjectKeywords = (schema: JsonObject): boolean =>
  schema[jsonSchemaKeywords.additionalProperties] !== undefined ||
  schema[jsonSchemaKeywords.properties] !== undefined ||
  schema[jsonSchemaKeywords.required] !== undefined;

const addInvalidSchemaDiagnostic = (
  context: ObjectLoweringContext,
  pointer: JsonPointer,
  message: string,
): void => {
  context.addDiagnostic({ code: "invalid_schema_document", message, pointer });
};

const requiredProperties = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ObjectLoweringContext,
): readonly string[] => {
  const required = schema[jsonSchemaKeywords.required];
  if (required === undefined) return [];
  if (!isJsonArray(required)) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema required must be an array of unique strings.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.required),
    });
    return [];
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const [index, key] of required.entries()) {
    const keyPointer = jsonSchemaPointerWithSegment(
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.required),
      index,
    );
    if (typeof key !== "string")
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: "JSON Schema required entries must be strings.",
        pointer: keyPointer,
      });
    else if (seen.has(key))
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: "JSON Schema required entries must be unique.",
        pointer: keyPointer,
      });
    else {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
};

const propertyPointer = (pointer: JsonPointer, key: string): JsonPointer =>
  jsonSchemaPointerWithSegment(
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.properties),
    key,
  );

const additionalPropertiesPointer = (pointer: JsonPointer): JsonPointer =>
  jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.additionalProperties);

const lowerAdditionalPropertyValue = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ObjectLoweringContext,
): ZodExpression => {
  const additionalProperties = schema[jsonSchemaKeywords.additionalProperties];
  if (additionalProperties === false) return zodPlan.never();
  if (additionalProperties === undefined || additionalProperties === true) return zodPlan.unknown();
  if (isJsonSchemaValue(additionalProperties))
    return context.lowerSchema(additionalPropertiesPointer(pointer), additionalProperties);

  addInvalidSchemaDiagnostic(
    context,
    additionalPropertiesPointer(pointer),
    "JSON Schema additionalProperties must be a boolean or schema object.",
  );
  return zodPlan.unknown();
};

const objectShape = ({
  context,
  pointer,
  required,
  schema,
}: ObjectShapeRequest): Record<string, ZodExpression> => {
  const properties = schema[jsonSchemaKeywords.properties];
  const shape: Record<string, ZodExpression> = {};

  if (properties !== undefined && !isJsonObject(properties))
    addInvalidSchemaDiagnostic(
      context,
      jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.properties),
      "JSON Schema properties must be an object.",
    );

  if (isJsonObject(properties))
    for (const [key, propertySchema] of Object.entries(properties))
      if (isJsonSchemaValue(propertySchema)) {
        const expression = context.lowerSchema(propertyPointer(pointer, key), propertySchema);
        shape[key] = required.has(key) ? expression : zodPlan.optional(expression);
      } else
        addInvalidSchemaDiagnostic(
          context,
          propertyPointer(pointer, key),
          "JSON Schema property values must be boolean schemas or schema objects.",
        );

  for (const key of required) shape[key] ??= lowerAdditionalPropertyValue(schema, pointer, context);

  return shape;
};

const requireKeys = (expression: ZodExpression, keys: readonly string[]): ZodExpression => {
  const [firstKey, ...remainingKeys] = keys;
  return firstKey === undefined
    ? expression
    : zodPlan.required(expression, [firstKey, ...remainingKeys]);
};

export const lowerJsonSchemaObject = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ObjectLoweringContext,
): ZodExpression => {
  const requiredKeys = requiredProperties(schema, pointer, context);
  const object = requireKeys(
    zodPlan.object(objectShape({ context, pointer, required: new Set(requiredKeys), schema })),
    requiredKeys,
  );
  const additionalProperties = schema[jsonSchemaKeywords.additionalProperties];

  if (additionalProperties === false) return zodPlan.strict(object);
  if (additionalProperties === undefined || additionalProperties === true)
    return zodPlan.passthrough(object);
  if (isJsonSchemaValue(additionalProperties))
    return zodPlan.catchall(
      object,
      context.lowerSchema(additionalPropertiesPointer(pointer), additionalProperties),
    );

  addInvalidSchemaDiagnostic(
    context,
    additionalPropertiesPointer(pointer),
    "JSON Schema additionalProperties must be a boolean or schema object.",
  );
  return object;
};
