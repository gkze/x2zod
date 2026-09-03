import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Diagnostic, JsonPointer, Result } from "@x2zod/core";

import { isJsonObject, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue } from "./document";
import {
  jsonSchemaResourceDocuments,
  normalizeExternalSchemaRegistry,
} from "./external-schema-registry";
import type { JsonSchemaResourceDocument } from "./external-schema-registry";
import { isValidJsonSchemaAnchorName, jsonSchemaAnchorKeywordsForDialect } from "./metadata";
import type { JsonSchemaDialect } from "./metadata";
import { emptyPointer } from "./pointer";
import { resolveJsonSchemaGraphDialect } from "./resource-dialect-discovery";
import type { JsonSchemaDialectResolutionGraph } from "./resource-dialect-discovery";
import { dialectAppliedSchemaChildren, dialectSchemaChildren } from "./resource-graph-children";
import { createJsonSchemaGraphReferenceResolvers } from "./resource-graph-resolution";
import { resourceGraphResult } from "./resource-graph-result";
import type {
  BuildJsonSchemaResourceGraphRequest,
  JsonSchemaLocationId,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph-types";
import { projectJsonSchemaIdentifier } from "./resource-identifier";
import type { JsonSchemaIdentifierProjection } from "./resource-identifier";
import { materializeReachablePointerReferences } from "./resource-pointer-materialization";
import { reachableResourceLocations } from "./resource-reachability";
import {
  canonicalJsonSchemaAddress,
  jsonSchemaReferenceTargetAddress,
  normalizeJsonSchemaRetrievalUri,
  resolveJsonSchemaUri as resolvedUri,
} from "./retrieval-uri";
import { jsonSchemaUriBoundaryDiagnostic } from "./schema-uri-boundaries";
import { compareCodeUnits } from "./string-order";

const rootSyntheticRetrievalUri = "x2zod://root/";

export type {
  BuildJsonSchemaResourceGraphRequest,
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
  ResolvedJsonSchemaGraphReference,
  ResolveJsonSchemaGraphReferenceRequest,
} from "./resource-graph-types";

const availableRootSyntheticRetrievalUri = (
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
): string => {
  let index = 0;
  let candidate = rootSyntheticRetrievalUri;
  while (Object.hasOwn(externalSchemas, candidate)) {
    index += 1;
    candidate = `${rootSyntheticRetrievalUri}${index.toString()}`;
  }
  return candidate;
};

type MutableResource = Readonly<{
  aliases: Set<string>;
  canonicalUri: string;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  retrievalUri: string;
}>;

type ResourceGraphBuildState = Readonly<{
  dialect: JsonSchemaDialect;
  dialectGraph: JsonSchemaDialectResolutionGraph | undefined;
  dialects: Map<JsonSchemaLocationId, JsonSchemaDialect>;
  duplicateTargets: Set<string>;
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  locations: Map<JsonSchemaLocationId, JsonSchemaResourceLocation>;
  resources: Map<JsonSchemaLocationId, MutableResource>;
  resourcesByLocation: Map<JsonSchemaLocationId, MutableResource>;
  schemaUriDiagnostics: Map<JsonSchemaLocationId, Diagnostic>;
  targets: Map<string, JsonSchemaLocationId>;
  targetLocations: Map<string, Set<JsonSchemaLocationId>>;
  invalidIdentifiers: Set<JsonSchemaLocationId>;
}>;

type SchemaVisitContext = Readonly<{
  baseUri: string;
  dialect: JsonSchemaDialect;
  documentRoot: boolean;
  pointer: JsonPointer;
  resource?: MutableResource | undefined;
  resourceUri: string;
  retrievalUri: string;
  schema: JsonSchemaValue;
}>;

type AddTargetRequest = Readonly<{
  location: JsonSchemaLocationId;
  resource: MutableResource;
  state: ResourceGraphBuildState;
  uri: string;
}>;
type ResourceForLocationRequest = Readonly<{
  context: SchemaVisitContext;
  id: JsonSchemaLocationId;
  projection: JsonSchemaIdentifierProjection;
  state: ResourceGraphBuildState;
}>;

export const jsonSchemaLocationId = (retrievalUri: string, pointer: string): JsonSchemaLocationId =>
  `${canonicalJsonSchemaAddress(retrievalUri)}#${pointer}`;

const addTarget = ({ location, resource, state, uri }: AddTargetRequest): void => {
  const canonicalUri = canonicalJsonSchemaAddress(uri);
  const existing = state.targets.get(canonicalUri);
  if (existing !== undefined && existing !== location) state.duplicateTargets.add(canonicalUri);
  else {
    state.targets.set(canonicalUri, location);
    resource.aliases.add(canonicalUri);
  }
  const targetLocations =
    state.targetLocations.get(canonicalUri) ?? new Set<JsonSchemaLocationId>();
  targetLocations.add(location);
  state.targetLocations.set(canonicalUri, targetLocations);
};

const addResource = (
  state: ResourceGraphBuildState,
  request: Readonly<{
    canonicalUri: string;
    documentRoot: boolean;
    location: JsonSchemaLocationId;
    pointer: JsonPointer;
    retrievalUri: string;
  }>,
): MutableResource => {
  const resource: MutableResource = {
    aliases: new Set<string>(),
    canonicalUri: canonicalJsonSchemaAddress(request.canonicalUri),
    location: request.location,
    pointer: request.pointer,
    retrievalUri: request.retrievalUri,
  };
  state.resources.set(request.location, resource);
  addTarget({ location: request.location, resource, state, uri: resource.canonicalUri });
  if (request.documentRoot)
    addTarget({
      location: request.location,
      resource,
      state,
      uri: canonicalJsonSchemaAddress(request.retrievalUri),
    });
  return resource;
};

const resourceForLocation = ({
  context,
  id,
  projection,
  state,
}: ResourceForLocationRequest): MutableResource => {
  if (projection.createsResource)
    return addResource(state, {
      canonicalUri: projection.resourceUri,
      documentRoot: context.documentRoot,
      location: id,
      pointer: context.pointer,
      retrievalUri: context.retrievalUri,
    });

  return (
    context.resource ??
    addResource(state, {
      canonicalUri: projection.resourceUri,
      documentRoot: context.documentRoot,
      location: id,
      pointer: context.pointer,
      retrievalUri: context.retrievalUri,
    })
  );
};

const visitSchema = (state: ResourceGraphBuildState, context: SchemaVisitContext): void => {
  const id = jsonSchemaLocationId(context.retrievalUri, context.pointer);
  const projection = projectJsonSchemaIdentifier(context, context.dialect);
  const resource = resourceForLocation({ context, id, projection, state });
  state.resourcesByLocation.set(id, resource);
  if (projection.invalidIdentifier === true) state.invalidIdentifiers.add(id);
  const uriDiagnostic = jsonSchemaUriBoundaryDiagnostic({
    dialect: context.dialect,
    pointer: context.pointer,
    resourceRoot: context.documentRoot || projection.createsResource,
    schema: context.schema,
  });
  if (uriDiagnostic !== undefined) state.schemaUriDiagnostics.set(id, uriDiagnostic);

  const location: JsonSchemaResourceLocation = {
    baseUri: projection.baseUri,
    id,
    pointer: context.pointer,
    resourceUri: projection.resourceUri,
    retrievalUri: context.retrievalUri,
    schema: context.schema,
  };
  state.locations.set(id, location);
  state.dialects.set(id, context.dialect);

  if (projection.fragment !== undefined)
    addTarget({
      location: id,
      resource,
      state,
      uri: jsonSchemaReferenceTargetAddress(projection.resourceUri, projection.fragment),
    });
  if (isJsonObject(context.schema)) {
    const addAnchorTarget = (anchor: unknown): void => {
      if (typeof anchor !== "string" || !isValidJsonSchemaAnchorName(anchor)) return;
      addTarget({
        location: id,
        resource,
        state,
        uri: jsonSchemaReferenceTargetAddress(projection.resourceUri, anchor),
      });
    };
    for (const keyword of jsonSchemaAnchorKeywordsForDialect(context.dialect))
      addAnchorTarget(context.schema[keyword]);
  }

  if (!isJsonObject(context.schema)) return;
  for (const child of dialectSchemaChildren(context.schema, context.pointer, context.dialect))
    visitSchema(state, {
      baseUri: projection.baseUri,
      dialect: resolveJsonSchemaGraphDialect({
        externalSchemas: state.externalSchemas,
        from: jsonSchemaLocationId(context.retrievalUri, child.pointer),
        graph: state.dialectGraph,
        inherited: context.dialect,
        schema: child.schema,
      }),
      documentRoot: false,
      pointer: child.pointer,
      resource,
      resourceUri: projection.resourceUri,
      retrievalUri: context.retrievalUri,
      schema: child.schema,
    });
};

const childLocations = (
  id: JsonSchemaLocationId,
  state: ResourceGraphBuildState,
): readonly JsonSchemaResourceLocation[] => {
  const location = state.locations.get(id);
  if (location === undefined || !isJsonObject(location.schema)) return [];
  return dialectAppliedSchemaChildren(
    location.schema,
    location.pointer,
    state.dialects.get(id) ?? state.dialect,
  )
    .flatMap((child) => {
      const childLocation = state.locations.get(
        jsonSchemaLocationId(location.retrievalUri, child.pointer),
      );
      return childLocation === undefined ? [] : [childLocation];
    })
    .toSorted((left, right) => compareCodeUnits(left.id, right.id));
};

const reachableGraphLocations = (
  root: JsonSchemaLocationId,
  resolver: JsonSchemaResourceGraph["resolve"],
  state: ResourceGraphBuildState,
): ReadonlySet<JsonSchemaLocationId> =>
  reachableResourceLocations({
    children: (id) => childLocations(id, state),
    dialectFor: (id) => state.dialects.get(id) ?? state.dialect,
    location: (id) => state.locations.get(id),
    resolve: resolver,
    root,
  });

const reachableGraphLocationsResult = (
  root: JsonSchemaLocationId,
  resolvers: Pick<JsonSchemaResourceGraph, "resolve" | "resolveUnique">,
  state: ResourceGraphBuildState,
): Result<readonly JsonSchemaLocationId[]> => {
  const diagnostics: Diagnostic[] = [];
  const reachable = reachableGraphLocations(
    root,
    (request) => {
      const target =
        request.reference === "" || request.reference.startsWith("#")
          ? ok(resolvers.resolve(request) ?? null)
          : resolvers.resolveUnique(request);
      if (!target.ok) diagnostics.push(...target.diagnostics);
      return target.ok ? (target.value ?? undefined) : undefined;
    },
    state,
  );
  const [failure] = diagnostics;
  return failure === undefined ? ok([...reachable].toSorted(compareCodeUnits)) : err(failure);
};

const createResourceGraphBuildState = (
  dialect: JsonSchemaDialect,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  dialectGraph: JsonSchemaDialectResolutionGraph | undefined,
): ResourceGraphBuildState => ({
  dialect,
  dialectGraph,
  dialects: new Map<JsonSchemaLocationId, JsonSchemaDialect>(),
  duplicateTargets: new Set<string>(),
  externalSchemas,
  invalidIdentifiers: new Set<JsonSchemaLocationId>(),
  locations: new Map<JsonSchemaLocationId, JsonSchemaResourceLocation>(),
  resources: new Map<JsonSchemaLocationId, MutableResource>(),
  resourcesByLocation: new Map<JsonSchemaLocationId, MutableResource>(),
  schemaUriDiagnostics: new Map<JsonSchemaLocationId, Diagnostic>(),
  targetLocations: new Map<string, Set<JsonSchemaLocationId>>(),
  targets: new Map<string, JsonSchemaLocationId>(),
});

const visitResourceDocuments = (
  documents: readonly JsonSchemaResourceDocument[],
  state: ResourceGraphBuildState,
): void => {
  for (const document of documents) {
    const pointer = jsonPointerFromPath([]);
    visitSchema(state, {
      baseUri: document.retrievalUri,
      dialect: resolveJsonSchemaGraphDialect({
        externalSchemas: state.externalSchemas,
        from: jsonSchemaLocationId(document.retrievalUri, pointer),
        graph: state.dialectGraph,
        inherited: state.dialect,
        schema: document.schema,
      }),
      documentRoot: true,
      pointer,
      resourceUri: document.retrievalUri,
      retrievalUri: document.retrievalUri,
      schema: document.schema,
    });
  }
};

const dialectResolutionGraph = (
  state: ResourceGraphBuildState,
): JsonSchemaDialectResolutionGraph => {
  const resolvers = createJsonSchemaGraphReferenceResolvers(state.locations, state.targetLocations);
  return {
    location: (id) => state.locations.get(id),
    resolveUnique: resolvers.resolveUnique,
    resources: [...state.resources.values()].map((resource) => ({
      canonicalUri: resource.canonicalUri,
      location: resource.location,
      pointer: resource.pointer,
      retrievalUri: resource.retrievalUri,
      aliases: [...resource.aliases],
    })),
  };
};

const dialectSignature = (state: ResourceGraphBuildState): string =>
  JSON.stringify([...state.dialects].toSorted(([left], [right]) => compareCodeUnits(left, right)));

const discoveredResourceGraphState = (
  documents: readonly JsonSchemaResourceDocument[],
  dialect: JsonSchemaDialect,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
): Result<ResourceGraphBuildState> => {
  const seen = new Set<string>();
  let previousSignature: string | undefined = undefined;
  let graph: JsonSchemaDialectResolutionGraph | undefined = undefined;
  for (;;) {
    const state = createResourceGraphBuildState(dialect, externalSchemas, graph);
    visitResourceDocuments(documents, state);
    const signature = dialectSignature(state);
    if (signature === previousSignature) return ok(state);
    if (seen.has(signature))
      return err(
        createDiagnostic({
          code: "invalid_schema_document",
          message: "JSON Schema resource dialect discovery did not converge.",
        }),
      );
    seen.add(signature);
    previousSignature = signature;
    graph = dialectResolutionGraph(state);
  }
};

export const buildJsonSchemaResourceGraph = (
  request: BuildJsonSchemaResourceGraphRequest,
): Result<JsonSchemaResourceGraph> => {
  const normalizedExternalSchemas = normalizeExternalSchemaRegistry(request.externalSchemas ?? {});
  if (!normalizedExternalSchemas.ok) return normalizedExternalSchemas;
  const normalizedRootRetrievalUri = normalizeJsonSchemaRetrievalUri(
    request.rootRetrievalUri ?? availableRootSyntheticRetrievalUri(normalizedExternalSchemas.value),
    "JSON Schema root retrieval URI",
  );
  if (!normalizedRootRetrievalUri.ok) return normalizedRootRetrievalUri;
  const documents = jsonSchemaResourceDocuments({
    externalSchemas: normalizedExternalSchemas.value,
    rootRetrievalUri: normalizedRootRetrievalUri.value,
    schema: request.schema,
  });
  const [duplicateRetrievalUris] = documents
    .map(({ retrievalUri }) => retrievalUri)
    .filter((uri, index, all) => all.indexOf(uri) !== index)
    .toSorted(compareCodeUnits);
  if (duplicateRetrievalUris !== undefined)
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        message: `JSON Schema retrieval URI is not unique after normalization: ${duplicateRetrievalUris}.`,
      }),
    );
  const discoveredState = discoveredResourceGraphState(
    documents,
    request.dialect,
    normalizedExternalSchemas.value,
  );
  if (!discoveredState.ok) return discoveredState;
  const state = discoveredState.value;

  const rootRetrievalUri = documents[0]?.retrievalUri ?? rootSyntheticRetrievalUri;
  const root = jsonSchemaLocationId(rootRetrievalUri, emptyPointer);
  const resolvers = createJsonSchemaGraphReferenceResolvers(state.locations, state.targetLocations);
  const documentsByRetrieval = new Map(
    documents.map((document) => [document.retrievalUri, document]),
  );
  let pointersChanged = true;
  while (pointersChanged)
    pointersChanged = materializeReachablePointerReferences({
      children: (schema, pointer, dialect) => dialectSchemaChildren(schema, pointer, dialect),
      dialectFor: (id) => state.dialects.get(id) ?? state.dialect,
      documents: documentsByRetrieval,
      location: (id) => state.locations.get(id),
      reachable: new Set(state.locations.keys()),
      resourceForReference: (source, reference, uri) => {
        if (reference === "" || reference.startsWith("#")) {
          const resource = state.resourcesByLocation.get(source.id);
          return resource === undefined ? undefined : state.locations.get(resource.location);
        }
        const exactDocument = documentsByRetrieval.get(uri);
        if (exactDocument !== undefined)
          return state.locations.get(
            jsonSchemaLocationId(exactDocument.retrievalUri, emptyPointer),
          );
        const id = state.targets.get(canonicalJsonSchemaAddress(uri));
        return id === undefined ? undefined : state.locations.get(id);
      },
      resolveUri: resolvedUri,
      visit: ({ parent, ...context }) => {
        visitSchema(state, {
          ...context,
          documentRoot: false,
          resource: state.resourcesByLocation.get(parent),
        });
      },
    });
  const uniqueReachable = reachableGraphLocationsResult(root, resolvers, state);
  if (!uniqueReachable.ok) return uniqueReachable;
  return resourceGraphResult({
    children: (id) => childLocations(id, state),
    duplicateTargets: state.duplicateTargets,
    invalidIdentifiers: state.invalidIdentifiers,
    location: (id) => state.locations.get(id),
    locations: state.locations,
    reachable: new Set(uniqueReachable.value),
    reachableFrom: (start) => reachableGraphLocationsResult(start, resolvers, state),
    resources: state.resources,
    schemaUriDiagnostics: state.schemaUriDiagnostics,
    ...resolvers,
    root,
    targetLocations: state.targetLocations,
  });
};
