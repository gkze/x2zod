import type { JsonPointer } from "@x2zod/core";

import type { JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerSegments, jsonSchemaPointerWithSegment } from "./pointer";

const draft7ReferenceAddressKeyword = "x2zodDraft7ReferenceAddress";

const jsonObjectFromEntries = (
  entries: readonly (readonly [string, JsonValue])[],
): Record<string, JsonValue> => {
  const object: Record<string, JsonValue> = {};
  for (const [key, value] of entries) object[key] = value;
  return object;
};

export const emittedDraft7Pointer = (
  pointer: JsonPointer,
  rootPointer: JsonPointer,
  referencePointers: ReadonlySet<string>,
): JsonPointer => {
  let originalPointer = rootPointer;
  let outputPointer = rootPointer;
  for (const segment of jsonSchemaPointerSegments(pointer)) {
    if (referencePointers.has(originalPointer))
      outputPointer = jsonSchemaPointerWithSegment(outputPointer, draft7ReferenceAddressKeyword);
    originalPointer = jsonSchemaPointerWithSegment(originalPointer, segment);
    outputPointer = jsonSchemaPointerWithSegment(outputPointer, segment);
  }
  return outputPointer;
};

export const isolatedDraft7ReferenceSchema = (
  entries: readonly (readonly [string, JsonValue])[],
): JsonValue => {
  const reference = entries.find(([key]) => key === jsonSchemaKeywords.ref)?.[1];
  if (typeof reference !== "string") return jsonObjectFromEntries(entries);
  const schema = entries.find(([key]) => key === jsonSchemaKeywords.schema);
  const addressEntries = entries.filter(
    ([key]) => key !== jsonSchemaKeywords.ref && key !== jsonSchemaKeywords.schema,
  );
  const isolated: Record<string, JsonValue> = {};
  if (schema !== undefined) {
    const [schemaKeyword, schemaUri] = schema;
    isolated[schemaKeyword] = schemaUri;
  }
  if (addressEntries.length > 0)
    isolated[draft7ReferenceAddressKeyword] = jsonObjectFromEntries(addressEntries);
  isolated[jsonSchemaKeywords.allOf] = [{ [jsonSchemaKeywords.ref]: reference }];
  return isolated;
};
