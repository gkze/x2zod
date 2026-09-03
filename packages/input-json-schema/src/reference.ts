import type { z } from "zod/v4";

import type { InputDocument, JsonPointer, Result } from "@x2zod/core";

import type { ParsedJsonSchemaDocument } from "./document";
import { normalizeUserExternalSchemaRegistry } from "./external-schema-registry";
import {
  selectedJsonSchemaMetaSchemaResources,
  validateJsonSchemaMetaSchemaIdentifierOwnership,
} from "./meta-schema-resolution";
import { supportedJsonSchemaMetaSchemas } from "./meta-schemas";
import type { ResolvedJsonSchemaInputPluginOptions } from "./options";
import { buildJsonSchemaResourceGraph, jsonSchemaLocationId } from "./resource-graph";
import type {
  JsonSchemaLocationId,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import { normalizeJsonSchemaRetrievalUri } from "./retrieval-uri";

export type JsonSchemaAddress = string & z.$brand<"JsonSchemaAddress">;

export type ResolvedJsonSchemaReference = Readonly<{
  address: JsonSchemaAddress;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  schema: JsonSchemaResourceLocation["schema"];
}>;

export type JsonSchemaReferenceResolver = Readonly<{
  graph: JsonSchemaResourceGraph;
  location: (
    pointer: JsonPointer,
    from: JsonSchemaLocationId,
  ) => JsonSchemaResourceLocation | undefined;
  resolve: (
    reference: string,
    from: JsonSchemaLocationId,
  ) => ResolvedJsonSchemaReference | undefined;
  root: ResolvedJsonSchemaReference;
}>;

export const jsonSchemaAddress = (value: string): JsonSchemaAddress => value as JsonSchemaAddress;

export const jsonSchemaDocumentRetrievalUri = (
  document: Pick<InputDocument, "retrievalUri" | "source">,
): string | undefined =>
  document.retrievalUri ?? (document.source.kind === "uri" ? document.source.uri : undefined);

const addressForLocation = (
  location: JsonSchemaResourceLocation,
  rootRetrievalUri: string,
): JsonSchemaAddress =>
  jsonSchemaAddress(
    location.retrievalUri === rootRetrievalUri
      ? location.pointer
      : `${location.retrievalUri}#${location.pointer}`,
  );

const resolvedReference = (
  location: JsonSchemaResourceLocation,
  rootRetrievalUri: string,
): ResolvedJsonSchemaReference => ({
  address: addressForLocation(location, rootRetrievalUri),
  location: location.id,
  pointer: location.pointer,
  schema: location.schema,
});

export const createJsonSchemaReferenceResolverFromGraph = (
  graph: JsonSchemaResourceGraph,
  rootLocationId: JsonSchemaLocationId,
): JsonSchemaReferenceResolver => {
  const rootLocation = graph.location(rootLocationId);
  if (rootLocation === undefined)
    throw new Error(`JSON Schema resource graph has no location ${rootLocationId}.`);
  const { retrievalUri: rootRetrievalUri } = rootLocation;

  return {
    graph,
    location: (pointer, from) => {
      const source = graph.location(from);
      return source === undefined
        ? undefined
        : graph.location(jsonSchemaLocationId(source.retrievalUri, pointer));
    },
    resolve: (reference, from) => {
      const target = graph.resolve({ from, reference });
      return target === undefined
        ? undefined
        : resolvedReference(target.location, rootRetrievalUri);
    },
    root: resolvedReference(rootLocation, rootRetrievalUri),
  };
};

export const createJsonSchemaReferenceResolver = (
  document: ParsedJsonSchemaDocument,
  options: ResolvedJsonSchemaInputPluginOptions,
): Result<JsonSchemaReferenceResolver> => {
  const normalizedExternalSchemas = normalizeUserExternalSchemaRegistry(options.externalSchemas);
  if (!normalizedExternalSchemas.ok) return normalizedExternalSchemas;
  const rootRetrievalUri = jsonSchemaDocumentRetrievalUri(document);
  const normalizedRootRetrievalUri =
    rootRetrievalUri === undefined
      ? undefined
      : normalizeJsonSchemaRetrievalUri(rootRetrievalUri, "JSON Schema root retrieval URI");
  if (normalizedRootRetrievalUri !== undefined && !normalizedRootRetrievalUri.ok)
    return normalizedRootRetrievalUri;
  const externalSchemas = {
    ...Object.fromEntries(
      Object.entries(supportedJsonSchemaMetaSchemas()).filter(
        ([uri]) => uri !== normalizedRootRetrievalUri?.value,
      ),
    ),
    ...normalizedExternalSchemas.value,
  };
  const graph = buildJsonSchemaResourceGraph({
    dialect: options.dialect,
    externalSchemas,
    schema: document.schema,
    ...(rootRetrievalUri === undefined ? {} : { rootRetrievalUri }),
  });
  if (!graph.ok) return graph;
  const reachable = new Set(graph.value.reachableLocations);
  const selected = selectedJsonSchemaMetaSchemaResources(
    graph.value,
    normalizedExternalSchemas.value,
    graph.value.resources.filter(({ location }) => reachable.has(location)),
  );
  if (!selected.ok) return selected;
  const ownership = validateJsonSchemaMetaSchemaIdentifierOwnership(selected.value);
  return ownership.ok
    ? { ...graph, value: createJsonSchemaReferenceResolverFromGraph(graph.value, graph.value.root) }
    : ownership;
};
