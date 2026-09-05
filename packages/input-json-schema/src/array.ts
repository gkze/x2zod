import { zodHelper, zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import { jsonSchemaArrayNeedsBroadRuntimeProjection } from "./array-runtime-projection";
import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";

const minimumItemCount = 0;

type ArrayLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{
    dialect: JsonSchemaDialect;
    lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression;
  }>;

const isItemCount = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimumItemCount;

const collectArrayAssertionDiagnostics = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ArrayLoweringContext,
): void => {
  const minItems = schema[jsonSchemaKeywords.minItems];
  const maxItems = schema[jsonSchemaKeywords.maxItems];
  const uniqueItems = schema[jsonSchemaKeywords.uniqueItems];

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
  if (uniqueItems !== undefined && typeof uniqueItems !== "boolean")
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema uniqueItems must be a boolean.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.uniqueItems),
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

const applyUniqueItems = (expression: ZodExpression, schema: JsonObject): ZodExpression =>
  schema[jsonSchemaKeywords.uniqueItems] === true
    ? zodPlan.refine(expression, zodHelper.uniqueItems())
    : expression;

const applyArrayAssertions = (expression: ZodExpression, schema: JsonObject): ZodExpression =>
  applyUniqueItems(applyArrayBounds(expression, schema), schema);

const arraySchemaEntryPointer = (
  pointer: JsonPointer,
  keyword: string,
  index: number,
): JsonPointer =>
  jsonSchemaPointerWithSegment(jsonSchemaPointerWithSegment(pointer, keyword), index);

type SchemaArrayDiagnosticRequest = Readonly<{
  keyword: string;
  pointer: JsonPointer;
  schemas: readonly JsonValue[];
}>;

const collectSchemaArrayEntryDiagnostics = (
  request: SchemaArrayDiagnosticRequest,
  context: ArrayLoweringContext,
): void => {
  const { keyword, pointer, schemas } = request;
  for (const [index, item] of schemas.entries())
    if (!isJsonSchemaValue(item))
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: `JSON Schema ${keyword} entries must be schemas.`,
        pointer: arraySchemaEntryPointer(pointer, keyword, index),
      });
};

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

  collectArrayAssertionDiagnostics(schema, pointer, context);
  collectSchemaArrayEntryDiagnostics(
    { keyword: jsonSchemaKeywords.prefixItems, pointer, schemas: prefixItems },
    context,
  );
  if (jsonSchemaArrayNeedsBroadRuntimeProjection(schema))
    return applyArrayBounds(zodPlan.array(zodPlan.unknown()), schema);

  const minItems = schema[jsonSchemaKeywords.minItems];
  const maxItems = schema[jsonSchemaKeywords.maxItems];
  if (minItems !== prefixItems.length || maxItems !== prefixItems.length)
    return zodPlan.array(zodPlan.unknown());

  const expressions: ZodExpression[] = [];
  for (const [index, item] of prefixItems.entries())
    if (isJsonSchemaValue(item))
      expressions.push(
        context.lowerSchema(
          arraySchemaEntryPointer(pointer, jsonSchemaKeywords.prefixItems, index),
          item,
        ),
      );
  const [firstExpression, ...remainingExpressions] = expressions;
  if (firstExpression === undefined) return zodPlan.array(zodPlan.unknown());
  return zodPlan.tuple([firstExpression, ...remainingExpressions]);
};

export const lowerJsonSchemaArray = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: ArrayLoweringContext,
): ZodExpression => {
  const tuple = lowerPrefixItems(schema, pointer, context);
  if (tuple !== undefined) return tuple;
  collectArrayAssertionDiagnostics(schema, pointer, context);

  const items = schema[jsonSchemaKeywords.items];
  if (items === undefined) return applyArrayAssertions(zodPlan.array(zodPlan.unknown()), schema);
  if (isJsonArray(items)) {
    collectSchemaArrayEntryDiagnostics(
      { keyword: jsonSchemaKeywords.items, pointer, schemas: items },
      context,
    );
    if (context.dialect === "draft-2020-12")
      context.addDiagnostic({
        code: "invalid_schema_document",
        message: "JSON Schema 2020-12 items must be a boolean schema or schema object.",
        pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.items),
      });
    return applyArrayBounds(zodPlan.array(zodPlan.unknown()), schema);
  }
  if (isJsonSchemaValue(items))
    return applyArrayAssertions(
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
  return applyArrayAssertions(zodPlan.array(zodPlan.unknown()), schema);
};
