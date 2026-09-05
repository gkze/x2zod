import { zodHelper, zodPlan } from "@x2zod/core";
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

type NumberConstraintsRequest = Readonly<{
  expression: ZodExpression;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const isNumberValue = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const minimumStringLength = 0;

const isStringLength = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimumStringLength;

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

export const applyJsonSchemaNumberConstraints = (
  request: NumberConstraintsRequest,
  context: ConstraintLoweringContext,
): ZodExpression => {
  let bounded = request.expression;
  const { pointer, schema } = request;
  const exclusiveMinimum = schema[jsonSchemaKeywords.exclusiveMinimum];
  const minimum = schema[jsonSchemaKeywords.minimum];
  const exclusiveMaximum = schema[jsonSchemaKeywords.exclusiveMaximum];
  const maximum = schema[jsonSchemaKeywords.maximum];
  const multipleOf = schema[jsonSchemaKeywords.multipleOf];

  for (const keyword of numberBoundKeywords)
    if (schema[keyword] !== undefined && !isNumberValue(schema[keyword]))
      addNumberBoundDiagnostic(keyword, pointer, context);

  if (isNumberValue(exclusiveMinimum)) bounded = zodPlan.gt(bounded, exclusiveMinimum);
  if (isNumberValue(minimum)) bounded = zodPlan.gte(bounded, minimum);
  if (isNumberValue(exclusiveMaximum)) bounded = zodPlan.lt(bounded, exclusiveMaximum);
  if (isNumberValue(maximum)) bounded = zodPlan.lte(bounded, maximum);
  if (multipleOf !== undefined && (!isNumberValue(multipleOf) || multipleOf <= 0))
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema multipleOf must be a positive number.",
      pointer: jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.multipleOf),
    });
  if (isNumberValue(multipleOf) && multipleOf > 0)
    bounded = zodPlan.refine(bounded, zodHelper.exactMultipleOf(multipleOf));

  return bounded;
};

export const hasJsonSchemaNumberConstraints = (schema: JsonObject): boolean =>
  numberBoundKeywords.some((keyword) => schema[keyword] !== undefined) ||
  schema[jsonSchemaKeywords.multipleOf] !== undefined;

const hasJsonSchemaStringPattern = (schema: JsonObject): boolean =>
  schema[jsonSchemaKeywords.pattern] !== undefined;

export const hasJsonSchemaStringConstraints = (schema: JsonObject): boolean =>
  hasJsonSchemaStringPattern(schema) ||
  schema[jsonSchemaKeywords.minLength] !== undefined ||
  schema[jsonSchemaKeywords.maxLength] !== undefined;

const collectStringLengthDiagnostics = (
  request: StringPatternRequest,
  context: ConstraintLoweringContext,
): void => {
  const minLength = request.schema[jsonSchemaKeywords.minLength];
  const maxLength = request.schema[jsonSchemaKeywords.maxLength];

  if (minLength !== undefined && !isStringLength(minLength))
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema minLength must be a non-negative integer.",
      pointer: jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.minLength),
    });
  if (maxLength !== undefined && !isStringLength(maxLength))
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema maxLength must be a non-negative integer.",
      pointer: jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.maxLength),
    });
};

const applyJsonSchemaStringPattern = (
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
    new RegExp(pattern, "u").test("");
  } catch {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema pattern must be a valid ECMAScript regular expression.",
      pointer: jsonSchemaPointerWithSegment(request.pointer, jsonSchemaKeywords.pattern),
    });
    return zodPlan.unknown();
  }

  return zodPlan.regex(request.expression, pattern, { unicode: true });
};

export const applyJsonSchemaStringConstraints = (
  request: StringPatternRequest,
  context: ConstraintLoweringContext,
): ZodExpression => {
  let constrained = applyJsonSchemaStringPattern(request, context);
  collectStringLengthDiagnostics(request, context);

  const minLength = request.schema[jsonSchemaKeywords.minLength];
  const maxLength = request.schema[jsonSchemaKeywords.maxLength];

  if (isStringLength(minLength) && isStringLength(maxLength) && minLength > maxLength)
    return zodPlan.never();

  if (isStringLength(minLength) || isStringLength(maxLength))
    constrained = zodPlan.refine(
      constrained,
      zodHelper.codePointLength(
        isStringLength(minLength) ? minLength : null,
        isStringLength(maxLength) ? maxLength : null,
      ),
    );

  return constrained;
};
