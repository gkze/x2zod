import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import {
  lowerJsonSchemaAllOf,
  lowerJsonSchemaAnyOf,
  lowerJsonSchemaNot,
  lowerJsonSchemaOneOf,
} from "./composition";
import type { JsonSchemaDiagnosticInput, JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { ResolvedJsonSchemaReference } from "./reference";
import {
  jsonSchemaHasUnsafeObjectBoundary,
  jsonSchemaSiblingAssertionSchema,
} from "./sibling-assertions";
import { lowerJsonSchemaSiblingIntersection } from "./sibling-intersection";
import {
  lowerJsonSchemaUnevaluatedAllOfObject,
  lowerJsonSchemaUnevaluatedRequiredCompositionObject,
} from "./unevaluated-properties";

type CompositionSchemaLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{
    lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression;
    resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
    dialect: JsonSchemaDialect;
    sourceProfile: JsonSchemaSourceProfile;
  }>;

type SimpleCompositionKeyword =
  | typeof jsonSchemaKeywords.anyOf
  | typeof jsonSchemaKeywords.not
  | typeof jsonSchemaKeywords.oneOf;

type SimpleCompositionLowerer = (
  value: JsonValue,
  pointer: JsonPointer,
  context: CompositionSchemaLoweringContext,
) => ZodExpression;

type ObjectTypeSiblingCompositionRequest = Readonly<{
  context: CompositionSchemaLoweringContext;
  keyword: SimpleCompositionKeyword;
  lower: SimpleCompositionLowerer;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

const isNonEmptySchemaArray = (value: JsonValue): boolean =>
  isJsonArray(value) && value.length > 0 && value.every((schema) => isJsonSchemaValue(schema));

const hasUnsafeAllOfIntersection = (
  value: JsonValue,
  context: CompositionSchemaLoweringContext,
): boolean =>
  isJsonArray(value) &&
  value.length > 1 &&
  value.some(
    (schema) =>
      isJsonSchemaValue(schema) &&
      jsonSchemaHasUnsafeObjectBoundary(schema, context.resolveReference),
  );

const siblingAssertionContext = (
  context: CompositionSchemaLoweringContext,
): Readonly<{
  addDiagnostic: (input: JsonSchemaDiagnosticInput) => void;
  dialect: JsonSchemaDialect;
  resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
  sourceProfile: JsonSchemaSourceProfile;
}> => ({
  addDiagnostic: context.addDiagnostic,
  dialect: context.dialect,
  resolveReference: context.resolveReference,
  sourceProfile: context.sourceProfile,
});

const lowerObjectTypeSiblingComposition = ({
  context,
  keyword,
  lower,
  pointer,
  schema,
}: ObjectTypeSiblingCompositionRequest): ZodExpression | undefined => {
  if (keyword !== jsonSchemaKeywords.anyOf && keyword !== jsonSchemaKeywords.oneOf)
    return undefined;

  const siblingSchema = jsonSchemaSiblingAssertionSchema(
    { keyword, pointer, schema },
    siblingAssertionContext(context),
  );
  if (
    siblingSchema?.[jsonSchemaKeywords.type] !== "object" ||
    Object.keys(siblingSchema).length !== 1
  )
    return undefined;

  const values = schema[keyword];
  if (!isJsonArray(values) || values.length === 0) return undefined;
  const objectBranches: JsonObject[] = [];
  for (const branch of values) {
    if (!isJsonObject(branch)) return undefined;
    const branchType = branch[jsonSchemaKeywords.type];
    if (branchType !== undefined && branchType !== "object") return undefined;
    objectBranches.push({ ...branch, type: "object" });
  }

  return lower(objectBranches, jsonSchemaPointerWithSegment(pointer, keyword), context);
};

const simpleCompositionLowerer =
  (schema: JsonObject, pointer: JsonPointer, context: CompositionSchemaLoweringContext) =>
  (
    keyword: SimpleCompositionKeyword,
    lower: SimpleCompositionLowerer,
  ): ZodExpression | undefined => {
    const value = schema[keyword];
    if (value === undefined) return undefined;
    const objectTypeSibling = lowerObjectTypeSiblingComposition({
      context,
      keyword,
      lower,
      pointer,
      schema,
    });
    if (objectTypeSibling !== undefined) return objectTypeSibling;

    const unevaluatedProperties = schema[jsonSchemaKeywords.unevaluatedProperties];
    if (
      (keyword === jsonSchemaKeywords.anyOf || keyword === jsonSchemaKeywords.oneOf) &&
      (unevaluatedProperties === false || isJsonObject(unevaluatedProperties)) &&
      isNonEmptySchemaArray(value)
    ) {
      const exactObject = lowerJsonSchemaUnevaluatedRequiredCompositionObject(
        { keyword, schema, schemaPointer: pointer, unevaluatedProperties },
        context,
      );
      if (exactObject !== undefined) return exactObject;
    }
    return lowerJsonSchemaSiblingIntersection(
      {
        expression: lower(value, jsonSchemaPointerWithSegment(pointer, keyword), context),
        keyword,
        pointer,
        schema,
      },
      { ...context, ...siblingAssertionContext(context) },
    );
  };

export const lowerJsonSchemaComposition = (
  schema: JsonObject,
  pointer: JsonPointer,
  context: CompositionSchemaLoweringContext,
): ZodExpression | undefined => {
  const lowerSimpleComposition = simpleCompositionLowerer(schema, pointer, context);
  const anyOf = lowerSimpleComposition(jsonSchemaKeywords.anyOf, lowerJsonSchemaAnyOf);
  if (anyOf !== undefined) return anyOf;

  const oneOf = lowerSimpleComposition(jsonSchemaKeywords.oneOf, lowerJsonSchemaOneOf);
  if (oneOf !== undefined) return oneOf;

  const allOfValues = schema[jsonSchemaKeywords.allOf];
  if (allOfValues !== undefined) {
    const allOfPointer = jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.allOf);
    const unevaluatedProperties = schema[jsonSchemaKeywords.unevaluatedProperties];
    if (
      (unevaluatedProperties === false || isJsonObject(unevaluatedProperties)) &&
      isNonEmptySchemaArray(allOfValues)
    )
      return lowerJsonSchemaUnevaluatedAllOfObject(
        { schema, schemaPointer: pointer, unevaluatedProperties },
        context,
      );
    if (hasUnsafeAllOfIntersection(allOfValues, context)) {
      context.addDiagnostic({
        code: "unrepresentable_schema_combination",
        message: [
          "JSON Schema allOf includes closed or schema-valued object boundaries",
          "that cannot be preserved by a plain Zod intersection.",
        ].join(" "),
        pointer: allOfPointer,
      });
      return zodPlan.unknown();
    }
    return lowerJsonSchemaSiblingIntersection(
      {
        expression: lowerJsonSchemaAllOf(allOfValues, allOfPointer, context),
        keyword: jsonSchemaKeywords.allOf,
        pointer,
        schema,
      },
      { ...context, ...siblingAssertionContext(context) },
    );
  }

  return lowerSimpleComposition(jsonSchemaKeywords.not, lowerJsonSchemaNot);
};
