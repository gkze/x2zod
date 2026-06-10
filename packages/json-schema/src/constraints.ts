import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonObject, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";

type ConstraintLoweringContext = JsonSchemaDiagnosticSink;

type StringPatternRequest = Readonly<{
  expression: ZodExpression;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

type NumberBoundsRequest = Readonly<{
  expression: ZodExpression;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const isNumberValue = (value: JsonValue | undefined): value is number => typeof value === "number";

const numberBoundKeywords = [
  jsonSchemaKeywords.exclusiveMinimum,
  jsonSchemaKeywords.minimum,
  jsonSchemaKeywords.exclusiveMaximum,
  jsonSchemaKeywords.maximum,
] as const;

const addNumberBoundDiagnostic = (
  keyword: (typeof numberBoundKeywords)[number],
  pointer: JsonPointer,
  context: ConstraintLoweringContext,
): void => {
  context.addDiagnostic({
    code: "invalid_schema_document",
    message: `JSON Schema ${keyword} must be a number.`,
    pointer: jsonSchemaPointerWithSegment(pointer, keyword),
  });
};

export const applyJsonSchemaNumberBounds = (
  request: NumberBoundsRequest,
  context: ConstraintLoweringContext,
): ZodExpression => {
  let bounded = request.expression;
  const { pointer, schema } = request;
  const exclusiveMinimum = schema[jsonSchemaKeywords.exclusiveMinimum];
  const minimum = schema[jsonSchemaKeywords.minimum];
  const exclusiveMaximum = schema[jsonSchemaKeywords.exclusiveMaximum];
  const maximum = schema[jsonSchemaKeywords.maximum];

  for (const keyword of numberBoundKeywords)
    if (schema[keyword] !== undefined && !isNumberValue(schema[keyword]))
      addNumberBoundDiagnostic(keyword, pointer, context);

  if (isNumberValue(exclusiveMinimum)) bounded = zodPlan.gt(bounded, exclusiveMinimum);
  if (isNumberValue(minimum)) bounded = zodPlan.gte(bounded, minimum);
  if (isNumberValue(exclusiveMaximum)) bounded = zodPlan.lt(bounded, exclusiveMaximum);
  if (isNumberValue(maximum)) bounded = zodPlan.lte(bounded, maximum);

  return bounded;
};

export const hasJsonSchemaNumberBounds = (schema: JsonObject): boolean =>
  numberBoundKeywords.some((keyword) => schema[keyword] !== undefined);

export const hasJsonSchemaStringPattern = (schema: JsonObject): boolean =>
  schema[jsonSchemaKeywords.pattern] !== undefined;

export const applyJsonSchemaStringPattern = (
  request: StringPatternRequest,
  context: ConstraintLoweringContext,
): ZodExpression => {
  const pattern = request.schema[jsonSchemaKeywords.pattern];
  if (pattern === undefined) return request.expression;
  if (typeof pattern !== "string") {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema pattern must be a string.",
      pointer: jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.pattern),
    });
    return zodPlan.unknown();
  }

  try {
    new RegExp(pattern).test("");
  } catch {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema pattern must be a valid ECMAScript regular expression.",
      pointer: jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.pattern),
    });
    return zodPlan.unknown();
  }

  return zodPlan.regex(request.expression, pattern);
};
