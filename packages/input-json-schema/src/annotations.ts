import type { ReadonlyDeep } from "type-fest";
import { z } from "zod/v4";

import { zodPlan } from "@x2zod/core";
import type { JsonPointer, ZodExpression } from "@x2zod/core";

import { isJsonArray, isJsonObject } from "./document";
import type { JsonValue } from "./document";
import type { LoweringContext } from "./lower-types";
import {
  jsonSchemaAnnotationKeywords,
  jsonSchemaKeywordPolicy,
  jsonSchemaKeywords,
} from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { JsonSchemaResourceLocation } from "./resource-graph";

/** Source metadata, not instance-evaluation annotation results. Pointers are document-relative. */
export type JsonSchemaAnnotation = Readonly<{
  keyword: string;
  pointer: JsonPointer;
  value: ReadonlyDeep<JsonValue>;
}>;

export type JsonSchemaAnnotationContext = Readonly<{
  annotations: readonly JsonSchemaAnnotation[];
  pointer: JsonPointer;
  resourceUri: string;
  retrievalUri: string;
}>;

export type JsonSchemaAnnotationProjection = Readonly<{ description?: string }>;
const annotationProjectionSchema: z.ZodType<JsonSchemaAnnotationProjection> = z
  .strictObject({ description: z.string().exactOptional() })
  .readonly();

/** A synchronous, deterministic metadata projection. It cannot introduce validation operations. */
export type JsonSchemaAnnotationProjector = (
  context: JsonSchemaAnnotationContext,
) => JsonSchemaAnnotationProjection;

const immutableJsonValue = (value: JsonValue): ReadonlyDeep<JsonValue> => {
  if (isJsonArray(value)) return Object.freeze(value.map((child) => immutableJsonValue(child)));
  if (isJsonObject(value))
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutableJsonValue(nested)]),
      ),
    );
  return value;
};

// Called only after keyword diagnostics have accepted every reachable schema location.
export const collectJsonSchemaAnnotations = (
  location: JsonSchemaResourceLocation,
): JsonSchemaAnnotationContext =>
  Object.freeze({
    annotations: Object.freeze(
      typeof location.schema === "boolean"
        ? []
        : Object.entries(location.schema).flatMap(([keyword, value]) =>
            jsonSchemaAnnotationKeywords.has(keyword) ||
            (!keyword.startsWith("$") && jsonSchemaKeywordPolicy(keyword) === "unknown")
              ? [
                  Object.freeze({
                    keyword,
                    pointer: jsonSchemaPointerWithSegment(location.pointer, keyword),
                    value: immutableJsonValue(value),
                  }),
                ]
              : [],
          ),
    ),
    pointer: location.pointer,
    resourceUri: location.resourceUri,
    retrievalUri: location.retrievalUri,
  });

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === "object" && value !== null) || typeof value === "function") &&
  "then" in value &&
  typeof value.then === "function";

export const projectJsonSchemaAnnotations = (
  annotations: JsonSchemaAnnotationContext,
  context: LoweringContext,
): JsonSchemaAnnotationProjection => {
  const description =
    context.options.annotationKeywords["description"] === true
      ? annotations.annotations.find(
          (annotation) => annotation.keyword === jsonSchemaKeywords.description,
        )?.value
      : undefined;
  const projected: unknown =
    context.projectAnnotations === undefined ? {} : context.projectAnnotations(annotations);
  if (isPromiseLike(projected)) {
    // Fail immediately, but consume a rejected asynchronous result before it reaches the host.
    Promise.resolve(projected).catch(() => {
      // The synchronous contract violation below is the compilation failure.
    });
    throw new TypeError("JSON Schema annotation projectors must return synchronously.");
  }
  // Validate the callback boundary even for JavaScript callers. Unknown fields must not disappear.
  const parsed = annotationProjectionSchema.parse(projected);
  return { ...(typeof description === "string" ? { description } : {}), ...parsed };
};

export const applyJsonSchemaAnnotationProjection = (
  expression: ZodExpression,
  projection: JsonSchemaAnnotationProjection | undefined,
): ZodExpression =>
  projection?.description === undefined
    ? expression
    : zodPlan.describe(expression, projection.description);
