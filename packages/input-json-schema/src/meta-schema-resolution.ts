import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result } from "@x2zod/core";

import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDocumentResource } from "./external-schema-registry";
import {
  isSupportedJsonSchemaMetaSchemaResource,
  jsonSchemaDialectForSchemaUri,
} from "./meta-schemas";
import { jsonSchemaKeywords } from "./metadata";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import {
  canonicalJsonSchemaAddress,
  resolveJsonSchemaUri,
  splitJsonSchemaUri,
} from "./retrieval-uri";

type ResolveJsonSchemaMetaSchemaRequest = Readonly<{
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  from: JsonSchemaLocationId;
  graph: Pick<JsonSchemaResourceGraph, "location" | "resolveUnique" | "resources">;
  reference: string;
}>;

type JsonSchemaMetaSchemaGraph = Pick<
  JsonSchemaResourceGraph,
  "location" | "resolveUnique" | "resources"
>;

export const customMetaSchemaReference = (schema: JsonSchemaValue): string | undefined => {
  if (!isJsonObject(schema)) return undefined;
  const reference = schema[jsonSchemaKeywords.schema];
  return typeof reference === "string" && jsonSchemaDialectForSchemaUri(reference) === undefined
    ? reference
    : undefined;
};

export const resolveJsonSchemaMetaSchemaLocation = ({
  externalSchemas,
  from,
  graph,
  reference,
}: ResolveJsonSchemaMetaSchemaRequest): Result<JsonSchemaResourceLocation | undefined> => {
  const source = graph.location(from);
  const absoluteReference =
    source === undefined
      ? canonicalJsonSchemaAddress(reference)
      : resolveJsonSchemaUri(source.baseUri, reference);
  const { fragment, resourceUri } = splitJsonSchemaUri(absoluteReference);
  if (Object.hasOwn(externalSchemas, resourceUri)) {
    const resource = jsonSchemaDocumentResource(graph.resources, resourceUri);
    const location = resource === undefined ? undefined : graph.location(resource.location);
    if (location === undefined || fragment === undefined || fragment === "") return ok(location);
    const resolved = graph.resolveUnique({ from: location.id, reference: `#${fragment}` });
    return resolved.ok ? ok(resolved.value?.location) : resolved;
  }
  const resolved = graph.resolveUnique({ from, reference });
  return resolved.ok ? ok(resolved.value?.location) : resolved;
};

export const createJsonSchemaGraphMetaSchemaResolver =
  (
    externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
    graph: JsonSchemaMetaSchemaGraph,
    from: JsonSchemaLocationId,
  ): ((reference: string) => Result<JsonSchemaValue | undefined>) =>
  (reference) => {
    const resolved = resolveJsonSchemaMetaSchemaLocation({
      externalSchemas,
      from,
      graph,
      reference,
    });
    return resolved.ok ? ok(resolved.value?.schema) : resolved;
  };

export const validateJsonSchemaMetaSchemaIdentifierOwnership = (
  resources: readonly JsonSchemaResource[],
): Result<true> => {
  const conflict = resources.find(
    ({ canonicalUri, retrievalUri }) =>
      canonicalUri !== retrievalUri && isSupportedJsonSchemaMetaSchemaResource(canonicalUri),
  );
  return conflict === undefined
    ? ok(true)
    : err(
        createDiagnostic({
          code: "invalid_schema_document",
          message: `JSON Schema resource identifier conflicts with a built-in meta-schema: ${conflict.canonicalUri}.`,
        }),
      );
};

export const selectedJsonSchemaMetaSchemaResources = (
  graph: JsonSchemaResourceGraph,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  resources: readonly JsonSchemaResource[],
): Result<readonly JsonSchemaResource[]> => {
  const selected = new Set(resources.map(({ location }) => location));
  const pending = [...resources];
  while (pending.length > 0) {
    const resource = pending.pop();
    const schema = resource === undefined ? undefined : graph.location(resource.location)?.schema;
    const reference = schema === undefined ? undefined : customMetaSchemaReference(schema);
    if (resource !== undefined && reference !== undefined) {
      const target = resolveJsonSchemaMetaSchemaLocation({
        externalSchemas,
        from: resource.location,
        graph,
        reference,
      });
      if (!target.ok) return target;
      if (target.value !== undefined) {
        const reachable = graph.reachableFrom(target.value.id);
        if (!reachable.ok) return reachable;
        const locations = new Set(reachable.value);
        const additions = graph.resources.filter(
          ({ location }) => locations.has(location) && !selected.has(location),
        );
        for (const candidate of additions) {
          selected.add(candidate.location);
          pending.push(candidate);
        }
      }
    }
  }
  return ok(graph.resources.filter(({ location }) => selected.has(location)));
};
