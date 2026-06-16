import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";

const minimumItemCount = 0;

type ArrayLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{ lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression }>;

export const hasJsonSchemaArrayKeywords = (schema: JsonObject): boolean =>
  schema[jsonSchemaKeywords.items] !== undefined ||
  schema[jsonSchemaKeywords.maxItems] !== undefined ||
  schema[jsonSchemaKeywords.minItems] !== undefined ||
  schema[jsonSchemaKeywords.prefixItems] !== undefined;

const isItemCount = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimumItemCount;

const collectArrayBoundDiagnostics = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ArrayLoweringContext,
): void => {
  const minItems = schema[jsonSchemaKeywords.minItems];
  const maxItems = schema[jsonSchemaKeywords.maxItems];

  if (minItems !== undefined && !isItemCount(minItems))
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema minItems must be a non-negative integer.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.minItems),
    });
  if (maxItems !== undefined && !isItemCount(maxItems))
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema maxItems must be a non-negative integer.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.maxItems),
    });
  if (isItemCount(minItems) && isItemCount(maxItems) && minItems > maxItems)
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema minItems cannot be greater than maxItems.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.maxItems),
    });
};

const applyArrayBounds = (expression: ZodExpression, schema: JsonObject): ZodExpression => {
  let bounded = expression;
  const minItems = schema[jsonSchemaKeywords.minItems];
  const maxItems = schema[jsonSchemaKeywords.maxItems];

  if (isItemCount(minItems)) bounded = zodPlan.min(bounded, minItems);
  if (isItemCount(maxItems)) bounded = zodPlan.max(bounded, maxItems);

  return bounded;
};

const prefixItemPointer = (pointer: JsonPointer, index: number): JsonPointer =>
  jsonSchemaPointerWithSegment(
    jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.prefixItems),
    index,
  );

const lowerPrefixItems = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ArrayLoweringContext,
): ZodExpression | undefined => {
  const prefixItems = schema[jsonSchemaKeywords.prefixItems];
  if (prefixItems === undefined) return undefined;
  if (!isJsonArray(prefixItems)) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema prefixItems must be an array of schemas.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.prefixItems),
    });
    return zodPlan.array(zodPlan.unknown());
  }

  collectArrayBoundDiagnostics(schema, pointer, context);
  const minItems = schema[jsonSchemaKeywords.minItems];
  const maxItems = schema[jsonSchemaKeywords.maxItems];
  if (minItems !== prefixItems.length || maxItems !== prefixItems.length) {
    context.addDiagnostic({
      code: "unsupported_keyword",
      message:
        "Only fixed-length prefixItems tuples are supported in this JSON Schema lowering slice.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.prefixItems),
    });
    return zodPlan.array(zodPlan.unknown());
  }

  const expressions: ZodExpression[] = [];
  for (const [index, item] of prefixItems.entries())
    if (isJsonSchemaValue(item))
      expressions.push(context.lowerSchema(prefixItemPointer(pointer, index), item));
    else
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: "JSON Schema prefixItems entries must be schemas.",
        pointer: prefixItemPointer(pointer, index),
      });
  const [firstExpression, ...remainingExpressions] = expressions;
  if (firstExpression === undefined) {
    context.addDiagnostic({
      code: "unsupported_keyword",
      message: "Empty fixed-length prefixItems tuples are not supported by this lowering slice.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.prefixItems),
    });
    return zodPlan.array(zodPlan.unknown());
  }
  return zodPlan.tuple([firstExpression, ...remainingExpressions]);
};

export const lowerJsonSchemaArray = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ArrayLoweringContext,
): ZodExpression => {
  const tuple = lowerPrefixItems(schema, pointer, context);
  if (tuple !== undefined) return tuple;
  collectArrayBoundDiagnostics(schema, pointer, context);

  const items = schema[jsonSchemaKeywords.items];
  if (items === undefined) return applyArrayBounds(zodPlan.array(zodPlan.unknown()), schema);
  if (isJsonArray(items)) {
    context.addDiagnostic({
      code: "unsupported_keyword",
      message: "Tuple items are not supported in the first JSON Schema lowering slice.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.items),
    });
    return zodPlan.array(zodPlan.unknown());
  }
  if (isJsonSchemaValue(items))
    return applyArrayBounds(
      zodPlan.array(
        context.lowerSchema(jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.items), items),
      ),
      schema,
    );

  context.addDiagnostic({
    code: "invalid_schema_document",
    message: "JSON Schema items must be a boolean schema or schema object.",
    pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.items),
  });
  return applyArrayBounds(zodPlan.array(zodPlan.unknown()), schema);
};
