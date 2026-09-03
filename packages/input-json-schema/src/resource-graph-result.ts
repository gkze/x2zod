import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Diagnostic, JsonPointer, Result } from "@x2zod/core";

import { emptyPointer } from "./pointer";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import { compareCodeUnits } from "./string-order";

type MutableResource = Readonly<{
  aliases: ReadonlySet<string>;
  canonicalUri: string;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  retrievalUri: string;
}>;

type ResourceGraphResultRequest = Readonly<{
  children: JsonSchemaResourceGraph["children"];
  duplicateTargets: ReadonlySet<string>;
  invalidIdentifiers: ReadonlySet<JsonSchemaLocationId>;
  location: JsonSchemaResourceGraph["location"];
  locations: ReadonlyMap<JsonSchemaLocationId, JsonSchemaResourceLocation>;
  reachable: ReadonlySet<JsonSchemaLocationId>;
  reachableFrom: JsonSchemaResourceGraph["reachableFrom"];
  resources: ReadonlyMap<JsonSchemaLocationId, MutableResource>;
  schemaUriDiagnostics: ReadonlyMap<JsonSchemaLocationId, Diagnostic>;
  resolve: JsonSchemaResourceGraph["resolve"];
  resolveUnique: JsonSchemaResourceGraph["resolveUnique"];
  root: JsonSchemaLocationId;
  targetLocations: ReadonlyMap<string, ReadonlySet<JsonSchemaLocationId>>;
}>;

type ResourceDocumentIntegrityRequest = Pick<
  ResourceGraphResultRequest,
  | "duplicateTargets"
  | "invalidIdentifiers"
  | "location"
  | "schemaUriDiagnostics"
  | "targetLocations"
>;

const hasDuplicateTargetWithinDocument = (
  targets: ReadonlySet<JsonSchemaLocationId>,
  retrievalUris: ReadonlySet<string>,
  location: JsonSchemaResourceGraph["location"],
): boolean => {
  const documents = new Set<string>();
  for (const target of targets) {
    const retrievalUri = location(target)?.retrievalUri;
    if (retrievalUri !== undefined && retrievalUris.has(retrievalUri)) {
      if (documents.has(retrievalUri)) return true;
      documents.add(retrievalUri);
    }
  }
  return false;
};

const validateResourceDocuments = (
  retrievalUris: ReadonlySet<string>,
  {
    duplicateTargets,
    invalidIdentifiers,
    location,
    schemaUriDiagnostics,
    targetLocations,
  }: ResourceDocumentIntegrityRequest,
): Result<true> => {
  const inSelectedDocument = (id: JsonSchemaLocationId): boolean => {
    const retrievalUri = location(id)?.retrievalUri;
    return retrievalUri !== undefined && retrievalUris.has(retrievalUri);
  };
  const [invalidIdentifier] = [...invalidIdentifiers]
    .filter((id) => inSelectedDocument(id))
    .toSorted(compareCodeUnits);
  if (invalidIdentifier !== undefined)
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        location: { pointer: location(invalidIdentifier)?.pointer ?? emptyPointer },
        message: "JSON Schema resource identifier is not a valid resource identifier.",
      }),
    );
  const [schemaUriDiagnostic] = [...schemaUriDiagnostics]
    .filter(([id]) => inSelectedDocument(id))
    .toSorted(([left], [right]) => compareCodeUnits(left, right));
  if (schemaUriDiagnostic !== undefined) return err(schemaUriDiagnostic[1]);
  const [duplicateTarget] = [...duplicateTargets]
    .filter((target) => {
      const targets = targetLocations.get(target) ?? new Set<JsonSchemaLocationId>();
      return hasDuplicateTargetWithinDocument(targets, retrievalUris, location);
    })
    .toSorted(compareCodeUnits);
  return duplicateTarget === undefined
    ? ok(true)
    : err(
        createDiagnostic({
          code: "invalid_schema_document",
          message: `JSON Schema resource identifier is not unique: ${duplicateTarget}.`,
        }),
      );
};

export const resourceGraphResult = ({
  children,
  duplicateTargets,
  invalidIdentifiers,
  location,
  locations,
  reachable,
  reachableFrom,
  resources,
  schemaUriDiagnostics,
  resolve,
  resolveUnique,
  root,
  targetLocations,
}: ResourceGraphResultRequest): Result<JsonSchemaResourceGraph> => {
  const reachableDocuments = new Set(
    [...reachable].flatMap((id) => {
      const retrievalUri = location(id)?.retrievalUri;
      return retrievalUri === undefined ? [] : [retrievalUri];
    }),
  );
  const integrityRequest = {
    duplicateTargets,
    invalidIdentifiers,
    location,
    schemaUriDiagnostics,
    targetLocations,
  };
  const integrity = validateResourceDocuments(reachableDocuments, integrityRequest);
  if (!integrity.ok) return integrity;
  const orderedLocations = [...locations.values()].toSorted((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const orderedResources = [...resources.values()]
    .map(
      (resource): JsonSchemaResource => ({
        aliases: [...resource.aliases].toSorted(compareCodeUnits),
        canonicalUri: resource.canonicalUri,
        location: resource.location,
        pointer: resource.pointer,
        retrievalUri: resource.retrievalUri,
      }),
    )
    .toSorted((left, right) => compareCodeUnits(left.location, right.location));
  return ok({
    children,
    location,
    locations: orderedLocations,
    reachableFrom,
    reachableLocations: [...reachable].toSorted(compareCodeUnits),
    resolve,
    resolveUnique,
    resources: orderedResources,
    root,
    validateResourceDocuments: (retrievalUris) =>
      validateResourceDocuments(retrievalUris, integrityRequest),
  });
};
