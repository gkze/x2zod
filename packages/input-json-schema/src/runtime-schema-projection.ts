import type { JsonPointer } from "@x2zod/core";

import type { JsonSchemaDialectPolicy } from "./dialect";
import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";
import type { LoweringContext } from "./lower-types";
import { jsonSchemaAtPointer, jsonSchemaPointerSegments } from "./pointer";

const invalidArrayIndex = -1;

const replaceJsonValueAtSegments = (
  value: JsonValue,
  segments: readonly string[],
  replacement: JsonSchemaValue,
): JsonValue => {
  const [segment, ...remaining] = segments;
  if (segment === undefined) return replacement;
  if (isJsonArray(value)) {
    const index = Number.parseInt(segment, 10);
    if (!Number.isInteger(index) || index === invalidArrayIndex || index >= value.length)
      return value;
    return value.map((child, childIndex) =>
      childIndex === index ? replaceJsonValueAtSegments(child, remaining, replacement) : child,
    );
  }
  if (!isJsonObject(value) || !Object.hasOwn(value, segment)) return value;
  const child = value[segment];
  if (child === undefined) return value;
  return { ...value, [segment]: replaceJsonValueAtSegments(child, remaining, replacement) };
};

const replaceJsonSchemaAtPointer = (
  value: JsonValue,
  pointer: JsonPointer,
  replacement: JsonSchemaValue,
): JsonValue => replaceJsonValueAtSegments(value, jsonSchemaPointerSegments(pointer), replacement);

type StripReachableRuntimeDocumentRequest = Readonly<{
  context: LoweringContext;
  fallbackPolicy: JsonSchemaDialectPolicy;
  retrievalUri: string;
  schema: JsonSchemaValue;
  stripSchema: (
    schema: JsonSchemaValue,
    policy: JsonSchemaDialectPolicy,
    externalSchemas: LoweringContext["options"]["externalSchemas"],
  ) => JsonSchemaValue;
}>;

export const stripReachableRuntimeDocument = ({
  context,
  fallbackPolicy,
  retrievalUri,
  schema,
  stripSchema,
}: StripReachableRuntimeDocumentRequest): JsonSchemaValue => {
  let transformed: JsonValue = schema;
  const locations = context.references.graph.locations
    .filter(
      (location) =>
        location.retrievalUri === retrievalUri &&
        context.references.graph.reachableLocations.includes(location.id),
    )
    .toSorted(
      (left, right) =>
        jsonSchemaPointerSegments(right.pointer).length -
        jsonSchemaPointerSegments(left.pointer).length,
    );
  for (const location of locations) {
    const current = isJsonSchemaValue(transformed)
      ? jsonSchemaAtPointer(transformed, location.pointer)
      : undefined;
    if (current !== undefined)
      transformed = replaceJsonSchemaAtPointer(
        transformed,
        location.pointer,
        stripSchema(
          current,
          context.resourcePolicies.get(location.id) ?? fallbackPolicy,
          context.options.externalSchemas,
        ),
      );
  }
  return isJsonSchemaValue(transformed) ? transformed : schema;
};
