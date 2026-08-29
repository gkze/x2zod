import { zodPlan } from "@x2zod/core";
import type { ZodExpression } from "@x2zod/core";

import { isJsonArray, isJsonObject, isJsonPrimitive } from "./document";
import type { JsonValue } from "./document";

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
