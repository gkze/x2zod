import type { ErrorObject, Options } from "ajv";

import { createDiagnostic, err, jsonPointerSchema, ok } from "@x2zod/core";
import type { Diagnostic, JsonPointer, Result, SourceLocationMap } from "@x2zod/core";

import { createJsonSchemaAjv } from "./ajv-factory";
import type { JsonSchemaAjv } from "./ajv-factory";
import {
  collectJsonSchemaCustomMetaKeywordDiagnostics,
  invalidJsonSchemaCustomMetaResources,
  jsonSchemaCustomMetaPolicyResources,
  resolveJsonSchemaCustomMetaSchemaTargets,
} from "./custom-meta-schema";
import type { JsonSchemaCustomMetaSchemaTarget } from "./custom-meta-schema";
import { jsonSchemaDiagnosticLocation, resultFromJsonSchemaDiagnostics } from "./diagnostics";
import type { JsonSchemaDialectPolicy } from "./dialect";
import { isJsonArray, isJsonObject, isJsonSchemaValue, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";
import { normalizeUserExternalSchemaRegistry } from "./external-schema-registry";
import {
  customMetaSchemaReference,
  resolveJsonSchemaMetaSchemaLocation,
  validateJsonSchemaMetaSchemaIdentifierOwnership,
} from "./meta-schema-resolution";
import { jsonSchemaDialectMetaSchemaAliases, supportedJsonSchemaMetaSchemas } from "./meta-schemas";
import { jsonSchemaValidationKeywords } from "./metadata";
import type { JsonSchemaDialect, ResolvedJsonSchemaInputPluginOptions } from "./options";
import { jsonSchemaPointerSegments, jsonSchemaPointerWithSegment } from "./pointer";
import { buildJsonSchemaResourceGraph } from "./resource-graph";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import {
  resolveJsonSchemaResourcePolicies,
  sourceLocationsForJsonSchemaResource,
} from "./resource-policies";
import { normalizeJsonSchemaRetrievalUri } from "./retrieval-uri";
import { compareCodeUnits } from "./string-order";

const ajvOptions = { allErrors: true, strict: false, validateSchema: true } satisfies Options;

const rootPointer = jsonPointerFromPath([]);

type PreflightJsonSchemaRequest = Readonly<{
  locations?: SourceLocationMap | undefined;
  options: ResolvedJsonSchemaInputPluginOptions;
  rootPolicy: JsonSchemaDialectPolicy;
  rootRetrievalUri?: string | undefined;
  schema: JsonSchemaValue;
}>;

const ajvPathToPointer = (instancePath: string): JsonPointer => {
  if (instancePath === "") return rootPointer;
  if (instancePath.startsWith("/")) {
    const parsed = jsonPointerSchema.safeParse(instancePath);
    if (parsed.success) return parsed.data;
  }
  return rootPointer;
};

const ajvForDialect = (dialect: JsonSchemaDialect): JsonSchemaAjv => {
  const ajv = createJsonSchemaAjv(dialect, ajvOptions);
  for (const [uri, schema] of Object.entries(jsonSchemaDialectMetaSchemaAliases(dialect)))
    ajv.addMetaSchema(schema, uri);
  return ajv;
};

type DiagnosticForErrorRequest = Readonly<{
  error: ErrorObject;
  locations?: SourceLocationMap | undefined;
  resource: JsonSchemaResourceLocation;
  rootRetrievalUri?: string | undefined;
}>;

const diagnosticForError = ({
  error,
  locations,
  resource,
  rootRetrievalUri,
}: DiagnosticForErrorRequest): Diagnostic => {
  let { pointer } = resource;
  for (const segment of jsonSchemaPointerSegments(ajvPathToPointer(error.instancePath)))
    pointer = jsonSchemaPointerWithSegment(pointer, segment);
  return createDiagnostic({
    code: "invalid_schema_document",
    location: jsonSchemaDiagnosticLocation(
      pointer,
      sourceLocationsForJsonSchemaResource(resource, { locations, rootRetrievalUri }),
    ),
    message: `JSON Schema document failed Ajv preflight: ${error.message ?? error.keyword}.`,
  });
};

type SelectedExternalSchemasRequest = Readonly<{
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  graph: JsonSchemaResourceGraph;
}>;

type ExternalSchemaSelection = Readonly<{
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  graph: JsonSchemaResourceGraph;
  inspectedMetaLocations: Set<JsonSchemaLocationId>;
  inspectedSchemas: Set<string>;
  metaLocationPending: JsonSchemaLocationId[];
  schemaPending: string[];
  selected: Set<string>;
}>;

const queueExternalDocument = (
  selection: ExternalSchemaSelection,
  retrievalUri: string,
  metaLocation?: JsonSchemaLocationId,
): void => {
  if (!Object.hasOwn(selection.externalSchemas, retrievalUri)) return;
  if (!selection.selected.has(retrievalUri)) {
    selection.selected.add(retrievalUri);
    selection.schemaPending.push(retrievalUri);
  }
  if (metaLocation !== undefined && !selection.inspectedMetaLocations.has(metaLocation))
    selection.metaLocationPending.push(metaLocation);
};

const selectSchemaDependencies = (
  retrievalUri: string,
  selection: ExternalSchemaSelection,
): Result<true> => {
  if (selection.inspectedSchemas.has(retrievalUri)) return ok(true);
  selection.inspectedSchemas.add(retrievalUri);
  for (const location of selection.graph.locations)
    if (location.retrievalUri === retrievalUri) {
      const reference = customMetaSchemaReference(location.schema);
      if (reference !== undefined) {
        const match = resolveJsonSchemaMetaSchemaLocation({
          externalSchemas: selection.externalSchemas,
          from: location.id,
          graph: selection.graph,
          reference,
        });
        if (!match.ok) return match;
        if (match.value !== undefined)
          queueExternalDocument(selection, match.value.retrievalUri, match.value.id);
      }
    }
  return ok(true);
};

const selectMetaReferenceDependencies = (
  location: JsonSchemaLocationId,
  selection: ExternalSchemaSelection,
): Result<true> => {
  if (selection.inspectedMetaLocations.has(location)) return ok(true);
  selection.inspectedMetaLocations.add(location);
  const reachable = selection.graph.reachableFrom(location);
  if (!reachable.ok) return reachable;
  for (const id of reachable.value) {
    const dependency = selection.graph.location(id);
    if (dependency !== undefined) queueExternalDocument(selection, dependency.retrievalUri);
  }
  return ok(true);
};

const selectedExternalSchemas = ({
  externalSchemas,
  graph,
}: SelectedExternalSchemasRequest): Result<readonly (readonly [string, JsonSchemaValue])[]> => {
  const entries = Object.entries(externalSchemas).toSorted(([left], [right]) =>
    compareCodeUnits(left, right),
  );
  const schemaPending = [
    ...new Set(
      graph.reachableLocations.flatMap((id) => {
        const location = graph.location(id);
        return location === undefined ? [] : [location.retrievalUri];
      }),
    ),
  ];
  const selection: ExternalSchemaSelection = {
    externalSchemas,
    graph,
    inspectedMetaLocations: new Set(),
    inspectedSchemas: new Set(),
    metaLocationPending: [],
    schemaPending,
    selected: new Set(
      schemaPending.filter((retrievalUri) => Object.hasOwn(externalSchemas, retrievalUri)),
    ),
  };

  while (selection.schemaPending.length > 0 || selection.metaLocationPending.length > 0) {
    const schemaRetrievalUri = selection.schemaPending.pop();
    if (schemaRetrievalUri !== undefined) {
      const dependencies = selectSchemaDependencies(schemaRetrievalUri, selection);
      if (!dependencies.ok) return dependencies;
    }

    const metaLocation = selection.metaLocationPending.pop();
    if (metaLocation !== undefined) {
      const dependencies = selectMetaReferenceDependencies(metaLocation, selection);
      if (!dependencies.ok) return dependencies;
    }
  }
  return ok(entries.filter(([uri]) => selection.selected.has(uri)));
};

const projectResourceForPreflight = (
  location: JsonSchemaResourceLocation,
  resources: readonly JsonSchemaResource[],
  validationVocabulary = true,
): JsonSchemaValue => {
  const nestedResources = new Set(
    resources.flatMap((resource) =>
      resource.retrievalUri === location.retrievalUri &&
      resource.pointer !== location.pointer &&
      resource.pointer.startsWith(`${location.pointer}/`)
        ? [resource.pointer]
        : [],
    ),
  );
  const project = (value: JsonValue, pointer: JsonPointer): JsonValue => {
    if (nestedResources.has(pointer)) return true;
    if (isJsonArray(value))
      return value.map((child, index) =>
        project(child, jsonSchemaPointerWithSegment(pointer, index)),
      );
    if (!isJsonObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => validationVocabulary || !jsonSchemaValidationKeywords.has(key))
        .map(([key, child]) => [key, project(child, jsonSchemaPointerWithSegment(pointer, key))]),
    );
  };
  const projected = project(location.schema, location.pointer);
  return isJsonSchemaValue(projected) ? projected : location.schema;
};

const createAjvProvider = (): ((dialect: JsonSchemaDialect) => JsonSchemaAjv) => {
  const ajvs = new Map<JsonSchemaDialect, JsonSchemaAjv>();
  return (dialect) => {
    const existing = ajvs.get(dialect);
    if (existing !== undefined) return existing;
    const ajv = ajvForDialect(dialect);
    ajvs.set(dialect, ajv);
    return ajv;
  };
};

type PreparedPreflight = Readonly<{
  customMetaSchemas: readonly JsonSchemaCustomMetaSchemaTarget[];
  dialect: JsonSchemaDialect;
  graph: JsonSchemaResourceGraph;
  locations?: SourceLocationMap | undefined;
  normalizedRootRetrievalUri?: string | undefined;
  options: ResolvedJsonSchemaInputPluginOptions;
  policies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
  resources: readonly JsonSchemaResource[];
}>;

const preparePreflight = (
  { locations, options, rootPolicy, rootRetrievalUri, schema }: PreflightJsonSchemaRequest,
  validateDocuments: boolean,
): Result<PreparedPreflight> => {
  const { dialect, externalSchemas } = options;
  const normalizedExternalSchemas = normalizeUserExternalSchemaRegistry(externalSchemas);
  if (!normalizedExternalSchemas.ok) return normalizedExternalSchemas;
  const normalizedRoot =
    rootRetrievalUri === undefined
      ? undefined
      : normalizeJsonSchemaRetrievalUri(rootRetrievalUri, "JSON Schema root retrieval URI");
  if (normalizedRoot !== undefined && !normalizedRoot.ok) return normalizedRoot;
  const graph = buildJsonSchemaResourceGraph({
    dialect,
    externalSchemas: {
      ...Object.fromEntries(
        Object.entries(supportedJsonSchemaMetaSchemas()).filter(
          ([uri]) => uri !== normalizedRoot?.value,
        ),
      ),
      ...normalizedExternalSchemas.value,
    },
    ...(normalizedRoot === undefined ? {} : { rootRetrievalUri: normalizedRoot.value }),
    schema,
  });
  if (!graph.ok) return graph;
  const selected = selectedExternalSchemas({
    externalSchemas: normalizedExternalSchemas.value,
    graph: graph.value,
  });
  if (!selected.ok) return selected;
  const selectedRetrievalUris = new Set(selected.value.map(([uri]) => uri));
  const normalizedRootRetrievalUri = graph.value.location(graph.value.root)?.retrievalUri;
  if (normalizedRootRetrievalUri !== undefined)
    selectedRetrievalUris.add(normalizedRootRetrievalUri);
  if (validateDocuments) {
    const integrity = graph.value.validateResourceDocuments(selectedRetrievalUris);
    if (!integrity.ok) return integrity;
  }
  const resources = graph.value.resources.filter((resource) =>
    selectedRetrievalUris.has(resource.retrievalUri),
  );
  const ownership = validateJsonSchemaMetaSchemaIdentifierOwnership(resources);
  if (!ownership.ok) return ownership;
  const customMetaSchemas = resolveJsonSchemaCustomMetaSchemaTargets(
    graph.value,
    normalizedExternalSchemas.value,
    resources,
  );
  if (!customMetaSchemas.ok) return customMetaSchemas;
  const policies = resolveJsonSchemaResourcePolicies({
    dialect,
    externalSchemas: normalizedExternalSchemas.value,
    graph: graph.value,
    locations,
    resources: jsonSchemaCustomMetaPolicyResources(graph.value, resources, customMetaSchemas.value),
    rootPolicy,
    validateUsage: validateDocuments
      ? (location): boolean => location.retrievalUri !== normalizedRootRetrievalUri
      : undefined,
  });
  return policies.ok
    ? ok({
        customMetaSchemas: customMetaSchemas.value,
        dialect,
        graph: graph.value,
        locations,
        normalizedRootRetrievalUri,
        options,
        policies: policies.value,
        resources,
      })
    : policies;
};

const customMetaKeywordDiagnostics = (context: PreparedPreflight): readonly Diagnostic[] =>
  collectJsonSchemaCustomMetaKeywordDiagnostics({
    graph: context.graph,
    options: context.options,
    policies: context.policies,
    sourceLocations: context.locations,
    targets: context.customMetaSchemas,
  });

export const validateJsonSchemaCustomMetaKeywords = (
  request: PreflightJsonSchemaRequest,
): Result<true> => {
  const context = preparePreflight(request, false);
  return context.ok
    ? resultFromJsonSchemaDiagnostics(true, customMetaKeywordDiagnostics(context.value))
    : context;
};

const customMetaDiagnostics = (context: PreparedPreflight): Result<readonly Diagnostic[]> => {
  const validation = invalidJsonSchemaCustomMetaResources({
    graph: context.graph,
    policies: context.policies,
    schemaForResource: (resource) => {
      const location = context.graph.location(resource.location);
      return location === undefined
        ? true
        : projectResourceForPreflight(location, context.resources);
    },
    targets: context.customMetaSchemas,
  });
  if (!validation.ok) return validation;
  const targets = new Map(
    context.customMetaSchemas.map((target) => [target.resource.location, target] as const),
  );
  return ok(
    validation.value.flatMap((resource) => {
      const location = context.graph.location(resource.location);
      const target = targets.get(resource.location);
      return location === undefined || target === undefined
        ? []
        : [
            createDiagnostic({
              code: "invalid_schema_document",
              location: jsonSchemaDiagnosticLocation(
                location.pointer,
                sourceLocationsForJsonSchemaResource(location, {
                  locations: context.locations,
                  rootRetrievalUri: context.normalizedRootRetrievalUri,
                }),
              ),
              message: `JSON Schema document failed custom meta-schema preflight: ${target.location.resourceUri}.`,
            }),
          ];
    }),
  );
};

const stockMetaDiagnostics = (context: PreparedPreflight): readonly Diagnostic[] => {
  const customResources = new Set(
    context.customMetaSchemas.map(({ resource }) => resource.location),
  );
  const provider = createAjvProvider();
  return context.resources.flatMap((resource) => {
    if (customResources.has(resource.location)) return [];
    const location = context.graph.location(resource.location);
    if (location === undefined) return [];
    const resourcePolicy = context.policies.get(location.id);
    const resourceDialect = resourcePolicy?.dialect ?? context.dialect;
    const ajv = provider(resourceDialect);
    return ajv.validateSchema(
      projectResourceForPreflight(location, context.resources, resourcePolicy?.validation),
    ) === true
      ? []
      : (ajv.errors ?? []).map((error) =>
          diagnosticForError({
            error,
            locations: context.locations,
            resource: location,
            rootRetrievalUri: context.normalizedRootRetrievalUri,
          }),
        );
  });
};

export const preflightJsonSchema = (
  request: PreflightJsonSchemaRequest,
): Result<JsonSchemaValue> => {
  if (request.options.validator === "none") return ok(request.schema);

  try {
    const context = preparePreflight(request, true);
    if (!context.ok) return context;
    const keywordDiagnostics = customMetaKeywordDiagnostics(context.value);
    const keywordResult = resultFromJsonSchemaDiagnostics(true, keywordDiagnostics);
    if (!keywordResult.ok) return keywordResult;
    const customDiagnostics = customMetaDiagnostics(context.value);
    if (!customDiagnostics.ok) return customDiagnostics;
    return resultFromJsonSchemaDiagnostics(request.schema, [
      ...keywordDiagnostics,
      ...customDiagnostics.value,
      ...stockMetaDiagnostics(context.value),
    ]);
  } catch (error) {
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        location: jsonSchemaDiagnosticLocation(rootPointer, request.locations),
        message: `JSON Schema document failed Ajv preflight: ${
          error instanceof Error ? error.message : "Unknown validation failure."
        }`,
      }),
    );
  }
};
