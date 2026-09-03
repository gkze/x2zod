import { jsonPointerSchema } from "@x2zod/core";
import type { JsonPointer } from "@x2zod/core";

import { isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords, jsonSchemaReferenceKeywordsForDialect } from "./metadata";
import type { JsonSchemaDialect } from "./metadata";
import {
  jsonSchemaAtPointer,
  jsonSchemaPointerSegments,
  jsonSchemaPointerWithSegment,
  jsonValueAtPointer,
} from "./pointer";

type ResourceLocation = Readonly<{
  baseUri: string;
  id: string;
  pointer: JsonPointer;
  resourceUri: string;
  retrievalUri: string;
  schema: JsonSchemaValue;
}>;

type Document = Readonly<{ retrievalUri: string; schema: JsonSchemaValue }>;
type Child = Readonly<{ pointer: JsonPointer }>;
const missingFragmentIndex = -1;

type ResourcePointerMaterializationRequest = Readonly<{
  children: (
    schema: Record<string, JsonValue>,
    pointer: JsonPointer,
    dialect: JsonSchemaDialect,
  ) => readonly Child[];
  documents: ReadonlyMap<string, Document>;
  location: (id: string) => ResourceLocation | undefined;
  reachable: ReadonlySet<string>;
  resourceForReference: (
    source: ResourceLocation,
    reference: string,
    uri: string,
  ) => ResourceLocation | undefined;
  resolveUri: (baseUri: string, reference: string) => string;
  visit: (
    input: Readonly<{
      baseUri: string;
      dialect: JsonSchemaDialect;
      parent: string;
      pointer: JsonPointer;
      resourceUri: string;
      retrievalUri: string;
      schema: JsonSchemaValue;
    }>,
  ) => void;
  dialectFor: (id: string) => JsonSchemaDialect;
}>;

const referenceValues = (schema: JsonSchemaValue, dialect: JsonSchemaDialect): readonly string[] =>
  isJsonObject(schema)
    ? Object.entries(schema).flatMap(([key, value]) =>
        (key === jsonSchemaKeywords.schema ||
          jsonSchemaReferenceKeywordsForDialect(dialect).includes(key)) &&
        typeof value === "string"
          ? [value]
          : [],
      )
    : [];

const pointerFromFragment = (fragment: string): JsonPointer | undefined => {
  try {
    const decoded = decodeURIComponent(fragment);
    const parsed = jsonPointerSchema.safeParse(decoded);
    return parsed.success && parsed.data.startsWith("/") ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const materializeReference = (
  source: ResourceLocation,
  reference: string,
  request: ResourcePointerMaterializationRequest,
): boolean => {
  const absoluteUri = request.resolveUri(source.baseUri, reference);
  const hashIndex = absoluteUri.indexOf("#");
  if (hashIndex === missingFragmentIndex) return false;
  const resourceUri = absoluteUri.slice(0, hashIndex);
  const fragment = pointerFromFragment(absoluteUri.slice(hashIndex + 1));
  const resource = request.resourceForReference(source, reference, resourceUri);
  if (fragment === undefined || resource === undefined) return false;
  const document = request.documents.get(resource.retrievalUri);
  if (document === undefined) return false;

  let currentLocation = resource;
  let currentPointer = resource.pointer;
  let changed = false;
  const targetSegments = jsonSchemaPointerSegments(fragment);
  for (const [index, segment] of targetSegments.entries()) {
    const nextPointer = jsonSchemaPointerWithSegment(currentPointer, segment);
    const nextValue = jsonValueAtPointer(document.schema, nextPointer);
    const finalSegment = index === targetSegments.length - 1;
    if (nextValue === undefined) break;
    const currentSchema = jsonSchemaAtPointer(document.schema, currentPointer);
    const dialect = request.dialectFor(currentLocation.id);
    const addressable =
      isJsonObject(currentSchema) &&
      request
        .children(currentSchema, currentPointer, dialect)
        .some((child) => child.pointer === nextPointer);
    const nextId = `${currentLocation.retrievalUri}#${nextPointer}`;
    const existingLocation = request.location(nextId);
    if (existingLocation !== undefined) currentLocation = existingLocation;
    if (addressable || finalSegment) {
      const nextSchema = isJsonSchemaValue(nextValue) ? nextValue : undefined;
      if (nextSchema === undefined) break;
      if (existingLocation === undefined) {
        request.visit({
          baseUri: currentLocation.baseUri,
          dialect,
          parent: currentLocation.id,
          pointer: nextPointer,
          resourceUri: currentLocation.resourceUri,
          retrievalUri: currentLocation.retrievalUri,
          schema: nextSchema,
        });
        changed = true;
      }
      currentLocation = request.location(nextId) ?? currentLocation;
    }
    currentPointer = nextPointer;
  }
  return changed;
};

export const materializeReachablePointerReferences = (
  request: ResourcePointerMaterializationRequest,
): boolean => {
  let changed = false;
  for (const id of [...request.reachable].toSorted()) {
    const source = request.location(id);
    if (source !== undefined)
      for (const reference of referenceValues(source.schema, request.dialectFor(id)))
        changed = materializeReference(source, reference, request) || changed;
  }
  return changed;
};
