import { jsonPointerSchema } from "@x2zod/core";
import type { JsonPointer } from "@x2zod/core";

import { isJsonArray, isJsonObject, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";

export const emptyPointer = "";

export const jsonSchemaPointerSegments = (pointer: JsonPointer): readonly string[] =>
  pointer === emptyPointer
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));

export const jsonSchemaPointerWithSegment = (
  pointer: JsonPointer,
  segment: string | number,
): JsonPointer => jsonPointerFromPath([...jsonSchemaPointerSegments(pointer), String(segment)]);

const arrayIndexSegmentPattern = /^(0|[1-9]\d*)$/u;

const valueAtPointerSegment = (
  value: JsonValue | undefined,
  segment: string,
): JsonValue | undefined => {
  if (isJsonArray(value)) {
    if (!arrayIndexSegmentPattern.test(segment)) return undefined;
    const index = Number.parseInt(segment, 10);
    return value[index];
  }
  return isJsonObject(value) ? value[segment] : undefined;
};

export const jsonSchemaAtPointer = (
  root: JsonSchemaValue,
  pointer: JsonPointer,
): JsonSchemaValue | undefined => {
  let current: JsonValue | undefined = root;
  for (const segment of jsonSchemaPointerSegments(pointer))
    current = valueAtPointerSegment(current, segment);

  return typeof current === "boolean" || isJsonObject(current) ? current : undefined;
};

export const jsonSchemaLocalRefToPointer = (ref: string): JsonPointer | undefined => {
  if (ref === "#") return jsonPointerFromPath([]);
  if (!ref.startsWith("#/")) return undefined;

  const parsed = jsonPointerSchema.safeParse(decodeURIComponent(ref.slice(1)));
  return parsed.success ? parsed.data : undefined;
};
