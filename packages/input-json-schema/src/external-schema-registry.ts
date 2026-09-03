import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result } from "@x2zod/core";

import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { isSupportedJsonSchemaMetaSchemaResource } from "./meta-schemas";
import { jsonSchemaKeywords } from "./metadata";
import { emptyPointer } from "./pointer";
import type { JsonSchemaResource } from "./resource-graph";
import {
  canonicalJsonSchemaAddress,
  isValidJsonSchemaUriReference,
  normalizeJsonSchemaRetrievalUri,
  resolveJsonSchemaUri,
} from "./retrieval-uri";
import { compareCodeUnits } from "./string-order";

export type JsonSchemaResourceDocument = Readonly<{
  retrievalUri: string;
  schema: JsonSchemaValue;
}>;

const jsonSchemaResourceDocumentCanonicalUri = ({
  retrievalUri,
  schema,
}: JsonSchemaResourceDocument): string => {
  if (!isJsonObject(schema)) return canonicalJsonSchemaAddress(retrievalUri);
  const identifier = schema[jsonSchemaKeywords.id];
  return typeof identifier === "string" && isValidJsonSchemaUriReference(identifier)
    ? resolveJsonSchemaUri(retrievalUri, identifier)
    : canonicalJsonSchemaAddress(retrievalUri);
};

export const jsonSchemaResourceDocuments = (
  request: Readonly<{
    externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
    rootRetrievalUri: string;
    schema: JsonSchemaValue;
  }>,
): readonly JsonSchemaResourceDocument[] => [
  { retrievalUri: request.rootRetrievalUri, schema: request.schema },
  ...Object.entries(request.externalSchemas)
    .toSorted(([left], [right]) => compareCodeUnits(left, right))
    .map(([retrievalUri, schema]) => ({ retrievalUri, schema })),
];

export const jsonSchemaDocumentResource = (
  resources: readonly JsonSchemaResource[],
  retrievalUri: string,
): JsonSchemaResource | undefined => {
  const normalized = normalizeJsonSchemaRetrievalUri(retrievalUri, "External schema registry key");
  if (!normalized.ok) return undefined;
  return resources.find(
    (resource) => resource.pointer === emptyPointer && resource.retrievalUri === normalized.value,
  );
};

export const normalizeExternalSchemaRegistry = (
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
): Result<Readonly<Record<string, JsonSchemaValue>>> => {
  const normalized = new Map<string, JsonSchemaValue>();
  for (const [uri, schema] of Object.entries(externalSchemas).toSorted(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    const normalizedUri = normalizeJsonSchemaRetrievalUri(uri, "External schema registry key");
    if (!normalizedUri.ok) return normalizedUri;
    const retrievalUri = normalizedUri.value;
    if (normalized.has(retrievalUri))
      return err(
        createDiagnostic({
          code: "invalid_schema_document",
          message: `External schema registry keys are not unique after normalization: ${retrievalUri}.`,
        }),
      );
    normalized.set(retrievalUri, schema);
  }
  return ok(Object.fromEntries(normalized));
};

export const normalizeUserExternalSchemaRegistry = (
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
): Result<Readonly<Record<string, JsonSchemaValue>>> => {
  const normalized = normalizeExternalSchemaRegistry(externalSchemas);
  if (!normalized.ok) return normalized;
  const reserved = Object.keys(normalized.value).find((uri) =>
    isSupportedJsonSchemaMetaSchemaResource(uri),
  );
  return reserved === undefined
    ? normalized
    : err(
        createDiagnostic({
          code: "invalid_schema_document",
          message: `External schema registry key is reserved for a built-in meta-schema: ${reserved}.`,
        }),
      );
};

export const resolveExternalSchemaRegistryDocument = (
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  reference: string,
): Result<JsonSchemaResourceDocument | undefined> => {
  const normalized = normalizeExternalSchemaRegistry(externalSchemas);
  if (!normalized.ok) return normalized;
  const canonicalReference = canonicalJsonSchemaAddress(reference);
  const exactSchema = normalized.value[canonicalReference];
  if (exactSchema !== undefined)
    return ok({ retrievalUri: canonicalReference, schema: exactSchema });

  const matches = Object.entries(normalized.value).flatMap(([retrievalUri, schema]) =>
    jsonSchemaResourceDocumentCanonicalUri({ retrievalUri, schema }) === canonicalReference
      ? [{ retrievalUri, schema }]
      : [],
  );
  if (matches.length > 1)
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        message: `External schema registry canonical identifier is ambiguous: ${canonicalReference}.`,
      }),
    );
  return ok(matches[0]);
};
