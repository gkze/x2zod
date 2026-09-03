import { jsonSchemaArrayNeedsBroadRuntimeProjection } from "./array-runtime-projection";
import { defaultJsonSchemaDialectPolicy } from "./dialect";
import type { JsonSchemaDialectPolicy } from "./dialect";
import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDocumentResource } from "./external-schema-registry";
import { isSupportedJsonSchemaMetaSchemaResource } from "./meta-schemas";
import { jsonSchemaKeywords, jsonSchemaReferenceKeywordsForDialect } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaInputPluginOptions } from "./options";
import type { JsonSchemaReferenceResolver, ResolvedJsonSchemaReference } from "./reference";
import { dialectRuntimeSchemaChildren } from "./resource-graph-children";
import { jsonSchemaResourceForLocation } from "./resource-graph-ownership";
import { canonicalJsonSchemaAddress, decodeJsonSchemaPlainNameFragment } from "./retrieval-uri";
import { isDraft7ReferenceSchema } from "./schema-applicability";

export type StandaloneRuntimeRequest = Readonly<{
  dialect: JsonSchemaDialect;
  externalSchemas: JsonSchemaInputPluginOptions["externalSchemas"];
  resourcePolicies?: ReadonlyMap<string, JsonSchemaDialectPolicy> | undefined;
  references: JsonSchemaReferenceResolver;
  schema: JsonSchemaValue;
}>;

type ReachableSchema = Pick<ResolvedJsonSchemaReference, "location" | "pointer" | "schema">;
export type JsonSchemaRuntimeProjection = "conservative" | "none" | "structural";

const standaloneRuntimeKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.contains,
  jsonSchemaKeywords.dependencies,
  jsonSchemaKeywords.dependentRequired,
  jsonSchemaKeywords.dependentSchemas,
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
  jsonSchemaKeywords.else,
  jsonSchemaKeywords.if,
  jsonSchemaKeywords.maxProperties,
  jsonSchemaKeywords.minProperties,
  jsonSchemaKeywords.patternProperties,
  jsonSchemaKeywords.recursiveAnchor,
  jsonSchemaKeywords.recursiveRef,
  jsonSchemaKeywords.thenKeyword,
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.unevaluatedProperties,
]);

const schemaRequiresStandaloneRuntime = (
  schema: JsonSchemaValue,
  dialect: JsonSchemaDialect,
): boolean =>
  isJsonObject(schema) &&
  (jsonSchemaArrayNeedsBroadRuntimeProjection(schema) ||
    Object.keys(schema).some(
      (keyword) =>
        standaloneRuntimeKeywords.has(keyword) &&
        (keyword !== jsonSchemaKeywords.dependencies || dialect === "draft-7"),
    ));

const policyForLocation = (
  request: StandaloneRuntimeRequest,
  location: ResolvedJsonSchemaReference["location"],
): JsonSchemaDialectPolicy =>
  request.resourcePolicies?.get(location) ?? defaultJsonSchemaDialectPolicy(request.dialect);

const linkedReachableSchemas = (
  current: ReachableSchema,
  request: StandaloneRuntimeRequest,
): readonly ReachableSchema[] => {
  const { location, pointer, schema } = current;
  if (!isJsonObject(schema)) return [];
  const { dialect } = policyForLocation(request, location);
  const linked: ReachableSchema[] = jsonSchemaReferenceKeywordsForDialect(dialect).flatMap(
    (keyword) => {
      const reference = schema[keyword];
      if (typeof reference !== "string") return [];
      const target = request.references.resolve(reference, location);
      return target === undefined ? [] : [target];
    },
  );
  for (const child of dialectRuntimeSchemaChildren(schema, pointer, dialect)) {
    const childLocation = request.references.location(child.pointer, location);
    if (childLocation !== undefined)
      linked.push({ location: childLocation.id, pointer: child.pointer, schema: child.schema });
  }
  return linked;
};

const dynamicAnchorTargets = (
  request: StandaloneRuntimeRequest,
  reachable: readonly ReachableSchema[],
  visited: ReadonlySet<ResolvedJsonSchemaReference["location"]>,
): readonly ReachableSchema[] => {
  const anchorNames = new Set(
    reachable.flatMap(({ location, schema }) => {
      if (policyForLocation(request, location).dialect !== "draft-2020-12") return [];
      if (!isJsonObject(schema)) return [];
      const reference = schema[jsonSchemaKeywords.dynamicRef];
      if (typeof reference !== "string") return [];
      const name = decodeJsonSchemaPlainNameFragment(reference);
      return name === undefined ? [] : [name];
    }),
  );
  if (anchorNames.size === 0) return [];
  const resourceLocations = new Set(
    reachable.flatMap(({ location }) => {
      const graphLocation = request.references.graph.location(location);
      const resource =
        graphLocation === undefined
          ? undefined
          : jsonSchemaResourceForLocation(request.references.graph.resources, graphLocation);
      return resource === undefined ? [] : [resource.location];
    }),
  );
  return request.references.graph.locations.flatMap((location) => {
    const resource = jsonSchemaResourceForLocation(request.references.graph.resources, location);
    if (
      visited.has(location.id) ||
      resource === undefined ||
      !resourceLocations.has(resource.location) ||
      !isJsonObject(location.schema)
    )
      return [];
    const anchor = location.schema[jsonSchemaKeywords.dynamicAnchor];
    return typeof anchor === "string" && anchorNames.has(anchor)
      ? [{ location: location.id, pointer: location.pointer, schema: location.schema }]
      : [];
  });
};

const reachableSchemas = (request: StandaloneRuntimeRequest): readonly ReachableSchema[] => {
  const pending: ReachableSchema[] = [request.references.root];
  const reachable: ReachableSchema[] = [];
  const visited = new Set<ResolvedJsonSchemaReference["location"]>();
  while (pending.length > 0) {
    while (pending.length > 0) {
      const current = pending.pop();
      if (current !== undefined && !visited.has(current.location)) {
        visited.add(current.location);
        reachable.push(current);
        pending.push(...linkedReachableSchemas(current, request));
      }
    }
    pending.push(...dynamicAnchorTargets(request, reachable, visited));
  }
  return reachable;
};

export const reachableRuntimeLocationIds = (
  request: StandaloneRuntimeRequest,
): ReadonlySet<ResolvedJsonSchemaReference["location"]> =>
  new Set(reachableSchemas(request).map(({ location }) => location));

const schemaNeedsConservativeRuntimeProjection = (schema: JsonSchemaValue): boolean =>
  isJsonObject(schema) &&
  schema[jsonSchemaKeywords.propertyNames] !== undefined &&
  schema[jsonSchemaKeywords.propertyNames] !== true;

export const jsonSchemaRuntimeProjection = (
  request: StandaloneRuntimeRequest,
): JsonSchemaRuntimeProjection => {
  let projection: JsonSchemaRuntimeProjection = "none";
  for (const { location, schema } of reachableSchemas(request)) {
    const resourceLocation = request.references.graph.location(location);
    if (
      resourceLocation !== undefined &&
      isSupportedJsonSchemaMetaSchemaResource(resourceLocation.resourceUri)
    )
      return "conservative";
    const { dialect } = policyForLocation(request, location);
    if (!isDraft7ReferenceSchema(schema, dialect)) {
      if (schemaNeedsConservativeRuntimeProjection(schema)) return "conservative";
      if (schemaRequiresStandaloneRuntime(schema, dialect)) projection = "structural";
    }
  }
  return projection;
};

const hasDuplicateResourceIdentifiers = (
  request: StandaloneRuntimeRequest,
  reachable: readonly ReachableSchema[],
): boolean => {
  const identifiers = new Map<string, string>();
  for (const { location } of reachable) {
    const graphLocation = request.references.graph.location(location);
    const resource =
      graphLocation === undefined
        ? undefined
        : jsonSchemaResourceForLocation(request.references.graph.resources, graphLocation);
    if (resource !== undefined) {
      const previous = identifiers.get(resource.canonicalUri);
      if (previous !== undefined && previous !== resource.location) return true;
      identifiers.set(resource.canonicalUri, resource.location);
    }
  }
  return false;
};

export const requestNeedsResourceGraphRuntime = (request: StandaloneRuntimeRequest): boolean => {
  const reachable = reachableSchemas(request);
  return (
    hasDuplicateResourceIdentifiers(request, reachable) ||
    reachable.some(
      ({ location, schema }) =>
        policyForLocation(request, location).dialect !== request.dialect ||
        (policyForLocation(request, location).dialect !== "draft-7" &&
          isJsonObject(schema) &&
          (schema[jsonSchemaKeywords.unevaluatedItems] !== undefined ||
            schema[jsonSchemaKeywords.unevaluatedProperties] !== undefined)),
    )
  );
};

export const reachableExternalSchemas = (
  request: StandaloneRuntimeRequest,
): JsonSchemaInputPluginOptions["externalSchemas"] => {
  const retrievalUris = new Set(
    reachableSchemas(request).flatMap(({ location }) => {
      const resourceLocation = request.references.graph.location(location);
      return resourceLocation === undefined ? [] : [resourceLocation.retrievalUri];
    }),
  );
  return Object.fromEntries(
    Object.entries(request.externalSchemas).flatMap(([uri, schema]) => {
      const resource = jsonSchemaDocumentResource(request.references.graph.resources, uri);
      return resource !== undefined && retrievalUris.has(resource.retrievalUri)
        ? [[canonicalJsonSchemaAddress(uri), schema] as const]
        : [];
    }),
  );
};
