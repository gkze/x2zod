import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import type { JsonSchemaDiagnosticSink } from "./diagnostics";
import { isJsonArray, isJsonObject, isJsonPrimitive, jsonStringValues } from "./document";
import type { JsonValue } from "./document";
import { oneOrUnion } from "./zod-expressions";

export const lowerJsonLiteral = (value: JsonValue): ZodExpression => {
  if (isJsonPrimitive(value)) return zodPlan.literal(value);
  if (isJsonArray(value)) return zodPlan.tuple(value.map((element) => lowerJsonLiteral(element)));
  if (isJsonObject(value)) {
    const object = zodPlan.strict(
      zodPlan.object(
        Object.fromEntries(
          Object.entries(value).map(([key, property]) => [key, lowerJsonLiteral(property)]),
        ),
      ),
    );
    return Object.hasOwn(value, "__proto__")
      ? zodPlan.preserveObjectInput(object, ["__proto__"])
      : object;
  }

  return zodPlan.never();
};

export const lowerJsonSchemaEnum = (
  values: JsonValue,
  pointer: JsonPointer,
  context: JsonSchemaDiagnosticSink,
): ZodExpression => {
  if (!isJsonArray(values)) {
    context.addDiagnostic({
      code: "invalid_schema_document",
      message: "JSON Schema enum must be an array.",
      pointer,
    });
    return zodPlan.unknown();
  }

  const stringValues = jsonStringValues(values);
  const [firstStringValue, ...remainingStringValues] = stringValues;
  if (firstStringValue !== undefined && stringValues.length === values.length)
    return zodPlan.enum([firstStringValue, ...remainingStringValues]);

  return oneOrUnion(values.map((value) => lowerJsonLiteral(value)));
};
