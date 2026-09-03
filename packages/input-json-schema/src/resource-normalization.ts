import type { JsonSchemaDialectPolicy } from "./dialect";
import { isJsonArray, isJsonObject, isJsonSchemaValue, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue, JsonValue } from "./document";
import {
  emittedDraft7Pointer,
  isolatedDraft7ReferenceSchema,
} from "./draft7-reference-normalization";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./options";
import { jsonSchemaPointerSegments, jsonSchemaPointerWithSegment } from "./pointer";
import { jsonSchemaPointerReference } from "./pointer-reference";
import type { JsonSchemaReferenceResolver, ResolvedJsonSchemaReference } from "./reference";
import type { JsonSchemaResource, JsonSchemaResourceLocation } from "./resource-graph";
import { dialectSchemaChildKeywordDescriptor } from "./resource-graph-children";
import type { JsonSchemaChildKeywordDescriptor } from "./resource-graph-children";
import { jsonSchemaResourceForLocation } from "./resource-graph-ownership";
import { isDraft7ReferenceSchema } from "./schema-applicability";
import {
  normalizeScopedReference,
  retainedScopedResourceUris,
} from "./scoped-reference-normalization";

type EmbeddedResourceNormalizationRequest = Readonly<{
  dialect: JsonSchemaDialect;
  reachableLocations?: ReadonlySet<ResolvedJsonSchemaReference["location"]> | undefined;
  references: JsonSchemaReferenceResolver;
  resourcePolicies?: ReadonlyMap<string, JsonSchemaDialectPolicy> | undefined;
  rootLocationId?: ResolvedJsonSchemaReference["location"] | undefined;
  schema: JsonSchemaValue;
}>;

type NormalizationContext = Readonly<{
  dialect: JsonSchemaDialect;
  draft7ReferencePointers: ReadonlySet<string>;
  dynamicResourceUris: ReadonlySet<string>;
  locationsByPointer: ReadonlyMap<string, ResolvedJsonSchemaReference["location"]>;
  reachablePointerPrefixes: ReadonlySet<string>;
  reachableLocations?: ReadonlySet<ResolvedJsonSchemaReference["location"]> | undefined;
  references: JsonSchemaReferenceResolver;
  retainedResources: readonly JsonSchemaResource[];
  resourcePolicies?: ReadonlyMap<string, JsonSchemaDialectPolicy> | undefined;
  rootPointer: ResolvedJsonSchemaReference["pointer"];
  rootRetrievalUri: string;
}>;

type NormalizeValueRequest = Readonly<{
  context: NormalizationContext;
  location?: ResolvedJsonSchemaReference["location"] | undefined;
  pointer: ResolvedJsonSchemaReference["pointer"];
  value: JsonValue;
}>;

type NormalizeChildRequest = Readonly<{
  child: JsonValue;
  context: NormalizationContext;
  location?: ResolvedJsonSchemaReference["location"] | undefined;
  normalizeValue: (request: NormalizeValueRequest) => JsonValue;
  pointer: ResolvedJsonSchemaReference["pointer"];
  pruneUnreachable?: boolean | undefined;
}>;

const locationAtPointer = (
  context: NormalizationContext,
  pointer: ResolvedJsonSchemaReference["pointer"],
): ResolvedJsonSchemaReference["location"] | undefined => context.locationsByPointer.get(pointer);

const dialectForLocation = (
  location: ResolvedJsonSchemaReference["location"] | undefined,
  context: NormalizationContext,
): JsonSchemaDialect =>
  (location === undefined ? undefined : context.resourcePolicies?.get(location)?.dialect) ??
  context.dialect;

const retainedResourceForLocation = (
  locationId: ResolvedJsonSchemaReference["location"],
  context: NormalizationContext,
): JsonSchemaResource | undefined => {
  const location = context.references.graph.location(locationId);
  return location === undefined
    ? undefined
    : jsonSchemaResourceForLocation(context.retainedResources, location);
};

const emittedPointer = (
  pointer: ResolvedJsonSchemaReference["pointer"],
  context: NormalizationContext,
): ResolvedJsonSchemaReference["pointer"] =>
  emittedDraft7Pointer(pointer, context.rootPointer, context.draft7ReferencePointers);

const relativePointer = (
  pointer: ResolvedJsonSchemaReference["pointer"],
  parent: ResolvedJsonSchemaReference["pointer"],
): ResolvedJsonSchemaReference["pointer"] =>
  jsonPointerFromPath(
    jsonSchemaPointerSegments(pointer).slice(jsonSchemaPointerSegments(parent).length),
  );

const normalizeReference = (
  reference: string,
  location: ResolvedJsonSchemaReference["location"],
  context: NormalizationContext,
): string => {
  const target = context.references.resolve(reference, location);
  if (target === undefined) return reference;
  const sourceResource = retainedResourceForLocation(location, context);
  const targetResource = retainedResourceForLocation(target.location, context);
  if (sourceResource !== undefined && targetResource !== undefined) {
    const outputTargetPointer = emittedPointer(target.pointer, context);
    const targetWithinSourceResource =
      sourceResource.retrievalUri === targetResource.retrievalUri &&
      (sourceResource.pointer === context.rootPointer ||
        target.pointer === sourceResource.pointer ||
        target.pointer.startsWith(`${sourceResource.pointer}/`));
    if (targetWithinSourceResource) {
      const outputSourcePointer = emittedPointer(sourceResource.pointer, context);
      const localPointer = relativePointer(outputTargetPointer, outputSourcePointer);
      return jsonSchemaPointerReference({
        local: true,
        pointer: localPointer,
        retrievalUri: sourceResource.canonicalUri,
        rootPointer: context.rootPointer,
      });
    }
    const outputResourcePointer = emittedPointer(targetResource.pointer, context);
    const targetPointer = relativePointer(outputTargetPointer, outputResourcePointer);
    return jsonSchemaPointerReference({
      local: false,
      pointer: targetPointer,
      retrievalUri: targetResource.canonicalUri,
      rootPointer: context.rootPointer,
    });
  }
  const targetLocation = context.references.graph.location(target.location);
  if (targetLocation === undefined) return reference;
  const outputTargetPointer = emittedPointer(target.pointer, context);
  const outputRootPointer = emittedPointer(context.rootPointer, context);
  return jsonSchemaPointerReference({
    local: targetLocation.retrievalUri === context.rootRetrievalUri,
    pointer: outputTargetPointer,
    retrievalUri: targetLocation.retrievalUri,
    rootPointer: outputRootPointer,
  });
};

const preservesDynamicResourceIdentity = (
  location: ResolvedJsonSchemaReference["location"] | undefined,
  context: NormalizationContext,
): boolean => {
  if (location === undefined) return false;
  const resourceUri = context.references.graph.location(location)?.resourceUri;
  return resourceUri !== undefined && context.dynamicResourceUris.has(resourceUri);
};

const normalizeSchema = ({
  child,
  context,
  normalizeValue,
  pointer,
}: NormalizeChildRequest): JsonValue =>
  isJsonSchemaValue(child)
    ? normalizeValue({
        context,
        location: locationAtPointer(context, pointer),
        pointer,
        value: child,
      })
    : child;

const normalizeSchemaArray = ({
  child,
  context,
  normalizeValue,
  pointer,
}: NormalizeChildRequest): JsonValue => {
  if (!isJsonArray(child)) return child;
  const normalized = child.map((value, index) =>
    normalizeSchema({
      child: value,
      context,
      normalizeValue,
      pointer: jsonSchemaPointerWithSegment(pointer, index),
    }),
  );
  return normalized.every((value, index) => value === child[index]) ? child : normalized;
};

const normalizeReachableDescendants = ({
  child,
  context,
  normalizeValue,
  pointer,
  pruneUnreachable,
}: NormalizeChildRequest): JsonValue => {
  if (!context.reachablePointerPrefixes.has(pointer)) return child;
  const location = locationAtPointer(context, pointer);
  if (
    location !== undefined &&
    (context.reachableLocations === undefined || context.reachableLocations.has(location))
  )
    return normalizeValue({ context, location, pointer, value: child });
  if (isJsonArray(child)) {
    const normalized = child.map((value, index) => {
      const childPointer = jsonSchemaPointerWithSegment(pointer, index);
      return pruneUnreachable === true && !context.reachablePointerPrefixes.has(childPointer)
        ? true
        : normalizeReachableDescendants({
            child: value,
            context,
            normalizeValue,
            pointer: childPointer,
            pruneUnreachable,
          });
    });
    return normalized.every((value, index) => value === child[index]) ? child : normalized;
  }
  if (!isJsonObject(child)) return child;
  const preserveResourceIdentity = preservesDynamicResourceIdentity(location, context);
  const normalized = Object.fromEntries(
    Object.entries(child).flatMap(([key, value]) => {
      const childPointer = jsonSchemaPointerWithSegment(pointer, key);
      if (
        pruneUnreachable === true &&
        !context.reachablePointerPrefixes.has(childPointer) &&
        !(key === jsonSchemaKeywords.id && preserveResourceIdentity)
      )
        return [];
      return [
        [
          key,
          normalizeReachableDescendants({
            child: value,
            context,
            normalizeValue,
            pointer: childPointer,
            pruneUnreachable,
          }),
        ],
      ];
    }),
  );
  return Object.entries(child).every(([key, value]) => normalized[key] === value)
    ? child
    : normalized;
};

type NormalizeSchemaMapValueRequest = Readonly<{
  descriptor: JsonSchemaChildKeywordDescriptor;
  request: NormalizeChildRequest;
  valueIsReachable: boolean;
}>;

const normalizeSchemaMapValue = ({
  descriptor,
  request,
  valueIsReachable,
}: NormalizeSchemaMapValueRequest): JsonValue => {
  if (descriptor.keyword === jsonSchemaKeywords.dependencies && isJsonArray(request.child))
    return request.child;
  if (descriptor.role === "declaration" && !valueIsReachable)
    return normalizeReachableDescendants({ ...request, pruneUnreachable: true });
  return normalizeSchema(request);
};

const normalizeSchemaMap = (
  request: NormalizeChildRequest,
  descriptor: JsonSchemaChildKeywordDescriptor,
): JsonValue => {
  const { child, context, normalizeValue, pointer } = request;
  if (!isJsonObject(child)) return child;
  const normalized = Object.fromEntries(
    Object.entries(child).flatMap(([key, value]) => {
      const valuePointer = jsonSchemaPointerWithSegment(pointer, key);
      const valueLocation = locationAtPointer(context, valuePointer);
      const reachablePointerPrefix = context.reachablePointerPrefixes.has(valuePointer);
      if (descriptor.role === "declaration" && !reachablePointerPrefix) return [];
      const valueIsReachable =
        valueLocation !== undefined &&
        (context.reachableLocations === undefined || context.reachableLocations.has(valueLocation));
      const normalizedValue = normalizeSchemaMapValue({
        descriptor,
        request: { child: value, context, normalizeValue, pointer: valuePointer },
        valueIsReachable,
      });
      return [[key, normalizedValue]];
    }),
  );
  return Object.entries(child).every(([key, value]) => normalized[key] === value)
    ? child
    : normalized;
};

const normalizeSchemaKeyword = (key: string, request: NormalizeChildRequest): JsonValue => {
  const descriptor = dialectSchemaChildKeywordDescriptor(
    dialectForLocation(request.location, request.context),
    key,
  );
  if (descriptor?.shape === "map") return normalizeSchemaMap(request, descriptor);
  if (
    descriptor?.shape === "array" ||
    (descriptor?.shape === "direct-or-array" && isJsonArray(request.child))
  )
    return normalizeSchemaArray(request);
  return descriptor?.shape === "direct" || descriptor?.shape === "direct-or-array"
    ? normalizeSchema(request)
    : normalizeReachableDescendants(request);
};

const isScopedReferenceKeyword = (keyword: string): boolean =>
  keyword === jsonSchemaKeywords.dynamicRef || keyword === jsonSchemaKeywords.recursiveRef;

const isEmptyDeclaration = (dialect: JsonSchemaDialect, key: string, value: JsonValue): boolean =>
  dialectSchemaChildKeywordDescriptor(dialect, key)?.role === "declaration" &&
  isJsonObject(value) &&
  Object.keys(value).length === 0;

const normalizeStaticValue = ({
  context,
  location,
  pointer,
  value,
}: NormalizeValueRequest): JsonValue => {
  if (!isJsonObject(value)) return value;
  const draft7Reference =
    location !== undefined && isDraft7ReferenceSchema(value, dialectForLocation(location, context));
  const normalizedEntries = Object.entries(value).flatMap(([key, child]) => {
    if (
      location !== undefined &&
      key === jsonSchemaKeywords.id &&
      (draft7Reference ||
        (pointer !== context.rootPointer && !preservesDynamicResourceIdentity(location, context)))
    )
      return [];
    if (location !== undefined && key === jsonSchemaKeywords.ref && typeof child === "string")
      return [[key, normalizeReference(child, location, context)]] as const;
    if (location !== undefined && isScopedReferenceKeyword(key) && typeof child === "string")
      return [
        [
          key,
          normalizeScopedReference({
            emittedPointer: (targetPointer) => emittedPointer(targetPointer, context),
            keyword: key,
            location,
            reference: child,
            references: context.references,
            rootPointer: context.rootPointer,
          }),
        ],
      ] as const;
    const childPointer = jsonSchemaPointerWithSegment(pointer, key);
    if (
      draft7Reference &&
      key !== jsonSchemaKeywords.schema &&
      !context.reachablePointerPrefixes.has(childPointer)
    )
      return [];
    const normalizedChild =
      draft7Reference && key !== jsonSchemaKeywords.schema
        ? normalizeReachableDescendants({
            child,
            context,
            normalizeValue: normalizeStaticValue,
            pointer: childPointer,
            pruneUnreachable: true,
          })
        : normalizeSchemaKeyword(key, {
            child,
            context,
            location,
            normalizeValue: normalizeStaticValue,
            pointer: childPointer,
          });
    if (isEmptyDeclaration(dialectForLocation(location, context), key, normalizedChild)) return [];
    return [[key, normalizedChild] as const];
  });
  return draft7Reference
    ? isolatedDraft7ReferenceSchema(normalizedEntries)
    : Object.fromEntries(normalizedEntries);
};

const reachableDraft7ReferencePointers = (
  request: EmbeddedResourceNormalizationRequest,
  locations: readonly JsonSchemaResourceLocation[],
): ReadonlySet<string> =>
  new Set(
    locations.flatMap((location) => {
      const dialect = request.resourcePolicies?.get(location.id)?.dialect ?? request.dialect;
      return isDraft7ReferenceSchema(location.schema, dialect) &&
        (request.reachableLocations === undefined || request.reachableLocations.has(location.id))
        ? [location.pointer]
        : [];
    }),
  );

export const normalizeEmbeddedResources = (
  request: EmbeddedResourceNormalizationRequest,
): JsonSchemaValue => {
  const rootLocationId = request.rootLocationId ?? request.references.graph.root;
  const rootLocation = request.references.graph.location(rootLocationId);
  if (rootLocation === undefined) return request.schema;
  const rootPointer = jsonPointerFromPath([]);
  const dynamicResourceUris = retainedScopedResourceUris(request);
  const graphLocations = request.references.graph.locations.filter(
    (location) => location.retrievalUri === rootLocation.retrievalUri,
  );
  const reachablePointerPrefixes = new Set(
    graphLocations.flatMap((location) => {
      if (request.reachableLocations !== undefined && !request.reachableLocations.has(location.id))
        return [];
      let pointer = rootPointer;
      return [
        rootPointer,
        ...jsonSchemaPointerSegments(location.pointer).map((segment) => {
          pointer = jsonSchemaPointerWithSegment(pointer, segment);
          return pointer;
        }),
      ];
    }),
  );
  const context: NormalizationContext = {
    dialect: request.dialect,
    draft7ReferencePointers: reachableDraft7ReferencePointers(request, graphLocations),
    dynamicResourceUris,
    locationsByPointer: new Map(
      graphLocations.map((location) => [location.pointer, location.id] as const),
    ),
    reachablePointerPrefixes,
    reachableLocations: request.reachableLocations,
    references: request.references,
    retainedResources: request.references.graph.resources.filter(
      (resource) =>
        resource.retrievalUri === rootLocation.retrievalUri &&
        (resource.pointer === rootPointer || dynamicResourceUris.has(resource.canonicalUri)),
    ),
    resourcePolicies: request.resourcePolicies,
    rootPointer,
    rootRetrievalUri: rootLocation.retrievalUri,
  };
  const normalized = normalizeStaticValue({
    context,
    location: rootLocationId,
    pointer: rootPointer,
    value: request.schema,
  });
  return isJsonSchemaValue(normalized) ? normalized : request.schema;
};
