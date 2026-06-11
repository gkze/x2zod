import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import {
  lowerJsonSchemaAllOf,
  lowerJsonSchemaAnyOf,
  lowerJsonSchemaNot,
  lowerJsonSchemaOneOf,
} from "./composition";
import type { JsonSchemaDiagnosticInput, JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaSourceProfile } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { ResolvedJsonSchemaReference } from "./reference";
import { hasUnsupportedSiblingAssertions } from "./sibling-assertions";
import { lowerJsonSchemaUnevaluatedAllOfObject } from "./unevaluated-properties";

type CompositionSchemaLoweringContext = JsonSchemaDiagnosticSink &
  Readonly<{
    lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression;
    resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
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

const siblingAssertionContext = (
  context: CompositionSchemaLoweringContext,
): Readonly<{
  addDiagnostic: (input: JsonSchemaDiagnosticInput) => void;
  sourceProfile: JsonSchemaSourceProfile;
}> => ({ addDiagnostic: context.addDiagnostic, sourceProfile: context.sourceProfile });

const simpleCompositionLowerer =
  (schema: JsonObject, pointer: JsonPointer, context: CompositionSchemaLoweringContext) =>
  (
    keyword: SimpleCompositionKeyword,
    lower: SimpleCompositionLowerer,
  ): ZodExpression | undefined => {
    const value = schema[keyword];
    if (value === undefined) return undefined;
    if (
      hasUnsupportedSiblingAssertions(
        { keyword, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    return lower(value, jsonSchemaPointerWithSegment(pointer, keyword), context);
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
    if (
      hasUnsupportedSiblingAssertions(
        { keyword: jsonSchemaKeywords.allOf, pointer, schema },
        siblingAssertionContext(context),
      )
    )
      return zodPlan.unknown();
    if (schema[jsonSchemaKeywords.unevaluatedProperties] === false)
      return lowerJsonSchemaUnevaluatedAllOfObject(
        { allOfPointer, schemaPointer: pointer, values: allOfValues },
        context,
      );
    return lowerJsonSchemaAllOf(allOfValues, allOfPointer, context);
  }

  return lowerSimpleComposition(jsonSchemaKeywords.not, lowerJsonSchemaNot);
};
