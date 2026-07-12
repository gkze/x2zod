import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import type { JsonObject, JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile } from "./options";
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
  }>;

export const lowerJsonSchemaSiblingIntersection = (
  request: SiblingIntersectionRequest,
  context: SiblingIntersectionContext,
): ZodExpression => {
  const { expression, keyword, pointer, schema } = request;
  if (hasUnsupportedUnevaluatedPropertiesSibling({ keyword, pointer, schema }, context))
    return zodPlan.unknown();

  const siblingSchema = jsonSchemaSiblingAssertionSchema({ keyword, pointer, schema }, context);
  if (siblingSchema === undefined) return expression;
  if (
    hasUnsupportedUntypedObjectSiblingIntersection(
      { keyword, pointer, schema },
      siblingSchema,
      context,
    )
  )
    return zodPlan.unknown();
  if (
    hasUnsupportedUntypedArraySiblingIntersection(
      { keyword, pointer, schema },
      siblingSchema,
      context,
    )
  )
    return zodPlan.unknown();
  if (keyword === jsonSchemaKeywords.not && schema[jsonSchemaKeywords.not] === false)
    return context.lowerSchema(pointer, siblingSchema);
  if (hasUnsupportedObjectSiblingIntersection({ keyword, pointer, schema }, context))
    return zodPlan.unknown();

  return zodPlan.intersection(context.lowerSchema(pointer, siblingSchema), expression);
};
