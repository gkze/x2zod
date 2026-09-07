import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonObject, JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type {
  JsonSchemaDialect,
  JsonSchemaSourceProfile,
  JsonSchemaUnknownKeywordPolicy,
} from "./options";
import type { ResolvedJsonSchemaReference } from "./reference";
import {
  hasUnsupportedObjectSiblingIntersection,
  hasUnsupportedUntypedArraySiblingIntersection,
  hasUnsupportedUnevaluatedPropertiesSibling,
  hasUnsupportedUntypedObjectSiblingIntersection,
  jsonSchemaSiblingAssertionSchema,
} from "./sibling-assertions";

type SiblingIntersectionRequest = Readonly<{
  expression: ZodExpression;
  keyword: string;
  pointer: JsonPointer;
  schema: JsonObject;
}>;

type SiblingIntersectionContext = JsonSchemaDiagnosticSink &
  Readonly<{
    dialect: JsonSchemaDialect;
    lowerSchema: (pointer: JsonPointer, schema: JsonSchemaValue) => ZodExpression;
    resolveReference: (ref: string) => ResolvedJsonSchemaReference | undefined;
    sourceProfile: JsonSchemaSourceProfile;
    unknownKeywords: JsonSchemaUnknownKeywordPolicy;
  }>;

export const lowerJsonSchemaSiblingIntersection = (
  request: SiblingIntersectionRequest,
  context: SiblingIntersectionContext,
): ZodExpression => {
  const { expression, keyword, pointer, schema } = request;
  const runtimeUnevaluated = hasUnsupportedUnevaluatedPropertiesSibling(
    { keyword, pointer, schema },
    context,
  );
  const siblingSchema = jsonSchemaSiblingAssertionSchema({ keyword, pointer, schema }, context);
  if (siblingSchema === undefined) return expression;
  hasUnsupportedUntypedObjectSiblingIntersection(
    { keyword, pointer, schema },
    siblingSchema,
    context,
  );
  hasUnsupportedUntypedArraySiblingIntersection(
    { keyword, pointer, schema },
    siblingSchema,
    context,
  );
  // Applicators may evaluate keys outside this sibling.
  // The runtime predicate owns that boundary; isolated lowering must not infer never.
  const structuralSibling = runtimeUnevaluated
    ? Object.fromEntries(
        Object.entries(siblingSchema).filter(
          ([key]) => key !== jsonSchemaKeywords.unevaluatedProperties,
        ),
      )
    : siblingSchema;
  if (keyword === jsonSchemaKeywords.not && schema[jsonSchemaKeywords.not] === false)
    return context.lowerSchema(pointer, structuralSibling);
  hasUnsupportedObjectSiblingIntersection({ keyword, pointer, schema }, context);

  return zodPlan.intersection(context.lowerSchema(pointer, structuralSibling), expression);
};
