import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Diagnostic, Result, SourceLocationMap } from "@x2zod/core";

import { addJsonSchemaDiagnostic } from "./diagnostics";
import type { JsonSchemaDialectPolicy } from "./dialect";
import type { JsonSchemaValue } from "./document";
import { collectKeywordDiagnostics } from "./keyword-diagnostics";
import {
  customMetaSchemaReference,
  resolveJsonSchemaMetaSchemaLocation,
} from "./meta-schema-resolution";
import type { ResolvedJsonSchemaInputPluginOptions } from "./options";
import { createJsonSchemaReferenceResolverFromGraph } from "./reference";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import { createRuntimeDescriptorValidator } from "./unevaluated-runtime";
import { buildRuntimeDescriptors } from "./unevaluated-runtime-descriptors";

export type JsonSchemaCustomMetaSchemaTarget = Readonly<{
  location: JsonSchemaResourceLocation;
  reachableLocations: ReadonlySet<JsonSchemaLocationId>;
  resource: JsonSchemaResource;
}>;

export const resolveJsonSchemaCustomMetaSchemaTargets = (
  graph: JsonSchemaResourceGraph,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  resources: readonly JsonSchemaResource[],
): Result<readonly JsonSchemaCustomMetaSchemaTarget[]> => {
  const targets: JsonSchemaCustomMetaSchemaTarget[] = [];
  for (const resource of resources) {
    const schema = graph.location(resource.location)?.schema;
    const reference = schema === undefined ? undefined : customMetaSchemaReference(schema);
    if (reference !== undefined) {
      const location = resolveJsonSchemaMetaSchemaLocation({
        externalSchemas,
        from: resource.location,
        graph,
        reference,
      });
      if (!location.ok) return location;
      if (location.value !== undefined) {
        const reachable = graph.reachableFrom(location.value.id);
        if (!reachable.ok) return reachable;
        targets.push({
          location: location.value,
          reachableLocations: new Set(reachable.value),
          resource,
        });
      }
    }
  }
  return ok(targets);
};

export const jsonSchemaCustomMetaPolicyResources = (
  graph: JsonSchemaResourceGraph,
  resources: readonly JsonSchemaResource[],
  targets: readonly JsonSchemaCustomMetaSchemaTarget[],
): readonly JsonSchemaResource[] => {
  const locations = new Set(resources.map(({ location }) => location));
  for (const target of targets)
    for (const resource of graph.resources)
      if (target.reachableLocations.has(resource.location)) locations.add(resource.location);
  return graph.resources.filter(({ location }) => locations.has(location));
};

export const collectJsonSchemaCustomMetaKeywordDiagnostics = (
  request: Readonly<{
    graph: JsonSchemaResourceGraph;
    options: ResolvedJsonSchemaInputPluginOptions;
    policies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
    sourceLocations?: SourceLocationMap | undefined;
    targets: readonly JsonSchemaCustomMetaSchemaTarget[];
  }>,
): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const reachable = new Set(
    request.targets.flatMap(({ reachableLocations }) => [...reachableLocations]),
  );
  const rootRetrievalUri = request.graph.location(request.graph.root)?.retrievalUri;
  for (const id of reachable) {
    const location = request.graph.location(id);
    const policy = request.policies.get(id);
    if (location !== undefined && policy !== undefined)
      collectKeywordDiagnostics(location.schema, location.pointer, {
        addDiagnostic: (input): void => {
          addJsonSchemaDiagnostic(
            diagnostics,
            input,
            location.retrievalUri === rootRetrievalUri ? request.sourceLocations : undefined,
          );
        },
        dialect: policy.dialect,
        formatAssertionVocabulary: policy.formatAssertion,
        options: request.options,
        policyForPointer: () => policy,
        validationVocabulary: policy.validation,
      });
  }
  return diagnostics;
};

type CustomMetaValidationRequest = Readonly<{
  graph: JsonSchemaResourceGraph;
  policies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
  schemaForResource: (resource: JsonSchemaResource) => JsonSchemaValue;
  targets: readonly JsonSchemaCustomMetaSchemaTarget[];
}>;

export const invalidJsonSchemaCustomMetaResources = ({
  graph,
  policies,
  schemaForResource,
  targets,
}: CustomMetaValidationRequest): Result<readonly JsonSchemaResource[]> => {
  const validators = new Map<JsonSchemaLocationId, (value: unknown) => boolean>();
  const invalid: JsonSchemaResource[] = [];
  for (const target of targets) {
    let validate = validators.get(target.location.id);
    if (validate === undefined) {
      const policy = policies.get(target.location.id);
      if (policy === undefined)
        return err(
          createDiagnostic({
            code: "invalid_schema_document",
            message: `JSON Schema custom meta-schema has no dialect policy: ${target.location.resourceUri}.`,
          }),
        );
      const descriptors = buildRuntimeDescriptors({
        dialect: policy.dialect,
        dialectForLocation: (location) => policies.get(location.id)?.dialect ?? policy.dialect,
        reachableLocations: target.reachableLocations,
        references: createJsonSchemaReferenceResolverFromGraph(graph, target.location.id),
        schemaForLocation: (location) => location.schema,
      });
      const validator = createRuntimeDescriptorValidator(
        descriptors,
        (location) => policies.get(location.id)?.dialect ?? policy.dialect,
      );
      if (!validator.ok) return validator;
      validate = validator.value;
      validators.set(target.location.id, validate);
    }
    if (!validate(schemaForResource(target.resource))) invalid.push(target.resource);
  }
  return ok(invalid);
};
