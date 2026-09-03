import { err, ok } from "@x2zod/core";
import type { Diagnostic, Result, SourceLocationMap } from "@x2zod/core";

import { createJsonSchemaDiagnostic } from "./diagnostics";
import {
  defaultJsonSchemaDialectPolicy,
  resolveJsonSchemaDialectPolicy,
  validateJsonSchemaVocabularyUsage,
} from "./dialect";
import type { JsonSchemaDialectPolicy } from "./dialect";
import { createJsonSchemaGraphMetaSchemaResolver } from "./meta-schema-resolution";
import type { JsonSchemaInputPluginOptions, JsonSchemaDialect } from "./options";
import { jsonSchemaPointerSegments, jsonSchemaPointerWithSegment } from "./pointer";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import { jsonSchemaResourceForLocation } from "./resource-graph-ownership";

const resourceDepth = (pointer: string): number =>
  pointer === "" ? 0 : pointer.split("/").length - 1;

const enclosingResource = (
  resources: readonly JsonSchemaResource[],
  resource: JsonSchemaResource,
): JsonSchemaResource | undefined =>
  resources
    .filter(
      (candidate) =>
        candidate.retrievalUri === resource.retrievalUri &&
        candidate.pointer !== resource.pointer &&
        resource.pointer.startsWith(`${candidate.pointer}/`),
    )
    .toSorted((left, right) => resourceDepth(right.pointer) - resourceDepth(left.pointer))[0];

const reachableJsonSchemaResources = (
  graph: JsonSchemaResourceGraph,
): readonly JsonSchemaResource[] => {
  const locations = new Set<JsonSchemaLocationId>();
  for (const locationId of graph.reachableLocations) {
    const reachable = graph.location(locationId);
    if (reachable !== undefined)
      for (const resource of graph.resources)
        if (
          resource.retrievalUri === reachable.retrievalUri &&
          (resource.pointer === reachable.pointer ||
            reachable.pointer.startsWith(`${resource.pointer}/`))
        )
          locations.add(resource.location);
  }
  return graph.resources
    .filter((resource) => locations.has(resource.location))
    .toSorted((left, right) => resourceDepth(left.pointer) - resourceDepth(right.pointer));
};

type ResourcePolicyRequest = Readonly<{
  dialect: JsonSchemaDialect;
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  graph: JsonSchemaResourceGraph;
  locations?: SourceLocationMap | undefined;
  resources?: readonly JsonSchemaResource[] | undefined;
  rootPolicy: JsonSchemaDialectPolicy;
  validateUsage?: ((location: JsonSchemaResourceLocation) => boolean) | undefined;
}>;
type ResourceDiagnosticContext = Pick<ResourcePolicyRequest, "locations"> &
  Readonly<{ rootRetrievalUri?: string | undefined }>;

export const sourceLocationsForJsonSchemaResource = (
  location: JsonSchemaResourceLocation,
  context: ResourceDiagnosticContext,
): SourceLocationMap | undefined =>
  location.retrievalUri === context.rootRetrievalUri ? context.locations : undefined;

const rebaseResourceDiagnostic = (
  diagnostic: Diagnostic,
  location: JsonSchemaResourceLocation,
  context: ResourceDiagnosticContext,
): Diagnostic => {
  let { pointer } = location;
  if (diagnostic.location !== undefined)
    for (const segment of jsonSchemaPointerSegments(diagnostic.location.pointer))
      pointer = jsonSchemaPointerWithSegment(pointer, segment);
  return createJsonSchemaDiagnostic(
    { code: diagnostic.code, message: diagnostic.message, pointer, severity: diagnostic.severity },
    sourceLocationsForJsonSchemaResource(location, context),
  );
};

const resourceUsageLocations = (
  graph: JsonSchemaResourceGraph,
  resources: readonly JsonSchemaResource[],
): Readonly<{
  diagnostics: readonly Diagnostic[];
  locations: ReadonlySet<JsonSchemaLocationId>;
}> => {
  const diagnostics: Diagnostic[] = [];
  const locations = new Set(graph.reachableLocations);
  for (const resource of resources)
    if (!locations.has(resource.location)) {
      const reachable = graph.reachableFrom(resource.location);
      if (reachable.ok) for (const id of reachable.value) locations.add(id);
      else diagnostics.push(...reachable.diagnostics);
    }
  return { diagnostics, locations };
};

type SelectedResourcePolicyRequest = Readonly<{
  diagnosticContext: ResourceDiagnosticContext;
  externalRootPolicy: JsonSchemaDialectPolicy;
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  graph: JsonSchemaResourceGraph;
  rootPolicy: JsonSchemaDialectPolicy;
  rootRetrievalUri?: string | undefined;
  selectedResources: readonly JsonSchemaResource[];
}>;

const resolveSelectedResourcePolicies = ({
  diagnosticContext,
  externalRootPolicy,
  externalSchemas,
  graph,
  rootPolicy,
  rootRetrievalUri,
  selectedResources,
}: SelectedResourcePolicyRequest): Readonly<{
  diagnostics: readonly Diagnostic[];
  policies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
}> => {
  const diagnostics: Diagnostic[] = [];
  const policies = new Map<JsonSchemaLocationId, JsonSchemaDialectPolicy>();
  for (const resource of selectedResources) {
    const location = graph.location(resource.location);
    if (location !== undefined)
      if (location.id === graph.root) policies.set(resource.location, rootPolicy);
      else {
        const parent = enclosingResource(graph.resources, resource);
        let inheritedPolicy =
          resource.retrievalUri === rootRetrievalUri ? rootPolicy : externalRootPolicy;
        if (parent !== undefined) inheritedPolicy = policies.get(parent.location) ?? rootPolicy;
        const policy = resolveJsonSchemaDialectPolicy(location.schema, inheritedPolicy, {
          externalSchemas,
          resolveMetaSchema: createJsonSchemaGraphMetaSchemaResolver(
            externalSchemas,
            graph,
            location.id,
          ),
        });
        if (policy.ok) policies.set(resource.location, policy.value);
        else
          diagnostics.push(
            ...policy.diagnostics.map((diagnostic) =>
              rebaseResourceDiagnostic(diagnostic, location, diagnosticContext),
            ),
          );
      }
  }
  return { diagnostics, policies };
};

type GraphLocationPolicyRequest = Readonly<{
  externalRootPolicy: JsonSchemaDialectPolicy;
  graph: JsonSchemaResourceGraph;
  policiesByResource: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
  rootPolicy: JsonSchemaDialectPolicy;
  rootRetrievalUri?: string | undefined;
}>;

const policiesForGraphLocations = ({
  externalRootPolicy,
  graph,
  policiesByResource,
  rootPolicy,
  rootRetrievalUri,
}: GraphLocationPolicyRequest): ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy> => {
  const resourcesByLocation = new Map(
    graph.resources.map((resource) => [resource.location, resource] as const),
  );
  return new Map(
    graph.locations.map((location) => {
      const resource =
        resourcesByLocation.get(location.id) ??
        jsonSchemaResourceForLocation(graph.resources, location);
      const defaultPolicy =
        location.retrievalUri === rootRetrievalUri ? rootPolicy : externalRootPolicy;
      return [
        location.id,
        (resource === undefined ? undefined : policiesByResource.get(resource.location)) ??
          defaultPolicy,
      ];
    }),
  );
};

type ResourceUsageDiagnosticsRequest = Readonly<{
  diagnosticContext: ResourceDiagnosticContext;
  graph: JsonSchemaResourceGraph;
  policies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
  selectedResources: readonly JsonSchemaResource[];
  validateUsage: (location: JsonSchemaResourceLocation) => boolean;
}>;

const resourceUsageDiagnostics = ({
  diagnosticContext,
  graph,
  policies,
  selectedResources,
  validateUsage,
}: ResourceUsageDiagnosticsRequest): readonly Diagnostic[] => {
  const usageScope = resourceUsageLocations(graph, selectedResources);
  const diagnostics = [...usageScope.diagnostics];
  for (const id of usageScope.locations) {
    const location = graph.location(id);
    const policy = policies.get(id);
    if (location !== undefined && policy !== undefined && validateUsage(location)) {
      const usage = validateJsonSchemaVocabularyUsage(location.schema, policy);
      if (!usage.ok)
        diagnostics.push(
          ...usage.diagnostics.map((diagnostic) =>
            rebaseResourceDiagnostic(diagnostic, location, diagnosticContext),
          ),
        );
    }
  }
  return diagnostics;
};

export const resolveJsonSchemaResourcePolicies = ({
  dialect,
  externalSchemas,
  graph,
  locations,
  resources,
  rootPolicy,
  validateUsage = () => true,
}: ResourcePolicyRequest): Result<ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>> => {
  const rootRetrievalUri = graph.location(graph.root)?.retrievalUri;
  const externalRootPolicy = defaultJsonSchemaDialectPolicy(dialect);
  const diagnosticContext: ResourceDiagnosticContext = { locations, rootRetrievalUri };

  const selectedResources = (resources ?? reachableJsonSchemaResources(graph)).toSorted(
    (left, right) => resourceDepth(left.pointer) - resourceDepth(right.pointer),
  );
  const selectedPolicies = resolveSelectedResourcePolicies({
    diagnosticContext,
    externalRootPolicy,
    externalSchemas,
    graph,
    rootPolicy,
    rootRetrievalUri,
    selectedResources,
  });
  const policies = policiesForGraphLocations({
    externalRootPolicy,
    graph,
    policiesByResource: selectedPolicies.policies,
    rootPolicy,
    rootRetrievalUri,
  });
  const diagnostics = [
    ...selectedPolicies.diagnostics,
    ...resourceUsageDiagnostics({
      diagnosticContext,
      graph,
      policies,
      selectedResources,
      validateUsage,
    }),
  ];

  const [firstDiagnostic, ...remainingDiagnostics] = diagnostics;
  return firstDiagnostic === undefined
    ? ok(policies)
    : err(firstDiagnostic, ...remainingDiagnostics);
};
