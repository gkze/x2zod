import { isJsonArray, isJsonObject, isJsonSchemaValue } from "./document";
import type { JsonObject, JsonSchemaValue, JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./options";
import { jsonSchemaPointerWithSegment } from "./pointer";
import type { JsonSchemaReferenceResolver } from "./reference";
import type {
  JsonSchemaLocationId,
  JsonSchemaResource,
  JsonSchemaResourceLocation,
} from "./resource-graph";
import { jsonSchemaResourceForLocation } from "./resource-graph-ownership";
import { decodeJsonSchemaPlainNameFragment } from "./retrieval-uri";
import { isDraft7ReferenceSchema } from "./schema-applicability";

type UnevaluatedRuntimeDescriptorRequest = Readonly<{
  dialect: JsonSchemaDialect;
  dialectForLocation?: ((location: JsonSchemaResourceLocation) => JsonSchemaDialect) | undefined;
  reachableLocations: ReadonlySet<JsonSchemaLocationId>;
  references: JsonSchemaReferenceResolver;
  schemaForLocation: (location: JsonSchemaResourceLocation) => JsonSchemaValue;
}>;

export type RuntimeDescriptor = Readonly<{
  additionalItems?: number | undefined;
  additionalProperties?:
    | Readonly<{ names: readonly string[]; patterns: readonly string[]; schema: number }>
    | undefined;
  allOf?: readonly number[] | undefined;
  anyOf?: readonly number[] | undefined;
  contains?: Readonly<{ maximum: number | null; minimum: number; schema: number }> | undefined;
  dependentSchemas?: Readonly<Record<string, number>> | undefined;
  dynamicRef?: Readonly<{ anchor: string; dynamic: boolean; target: number }> | undefined;
  elseSchema?: number | undefined;
  ifSchema?: number | undefined;
  items?: Readonly<{ from: number; schema: number }> | undefined;
  notSchema?: number | undefined;
  oneOf?: readonly number[] | undefined;
  patternProperties?: readonly (readonly [string, number])[] | undefined;
  prefixItems?: readonly number[] | undefined;
  propertyNames?: number | undefined;
  properties?: Readonly<Record<string, number>> | undefined;
  recursiveRef?: Readonly<{ dynamic: boolean; target: number }> | undefined;
  ref?: number | undefined;
  resource: number;
  thenSchema?: number | undefined;
  unevaluatedItems?: number | undefined;
  unevaluatedProperties?: number | undefined;
  validator: number;
}>;

export type RuntimeResource = Readonly<{
  dynamicAnchors: readonly (readonly [string, number])[];
  recursiveAnchor?: number | undefined;
}>;

export type RuntimeDescriptorGraph = Readonly<{
  descriptors: readonly RuntimeDescriptor[];
  locations: readonly JsonSchemaResourceLocation[];
  resources: readonly RuntimeResource[];
  root: number;
}>;

type AddLocation = (location: JsonSchemaResourceLocation) => number;
type ChildRequest = Readonly<{
  addLocation: AddLocation;
  keyword: string;
  parent: JsonSchemaResourceLocation;
  references: JsonSchemaReferenceResolver;
  schema: JsonObject;
}>;
type ChildRequestSource = Readonly<{
  addLocation: AddLocation;
  location: JsonSchemaResourceLocation;
  references: JsonSchemaReferenceResolver;
  schema: JsonObject;
}>;
type ApplicatorRequest = ChildRequestSource & Readonly<{ dialect: JsonSchemaDialect }>;

const childLocation = (
  request: Readonly<{
    parent: JsonSchemaResourceLocation;
    pointer: JsonSchemaResourceLocation["pointer"];
    references: JsonSchemaReferenceResolver;
  }>,
): JsonSchemaResourceLocation | undefined =>
  request.references.location(request.pointer, request.parent.id);

const childAt = (
  request: Readonly<{
    addLocation: AddLocation;
    parent: JsonSchemaResourceLocation;
    pointer: JsonSchemaResourceLocation["pointer"];
    references: JsonSchemaReferenceResolver;
  }>,
): number | undefined => {
  const location = childLocation(request);
  return location === undefined ? undefined : request.addLocation(location);
};

const mappedChildren = (request: ChildRequest): Readonly<Record<string, number>> | undefined => {
  const value = request.schema[request.keyword];
  if (!isJsonObject(value)) return undefined;
  const pointer = jsonSchemaPointerWithSegment(request.parent.pointer, request.keyword);
  const entries = Object.entries(value).flatMap(([key, child]) => {
    if (!isJsonSchemaValue(child)) return [];
    const index = childAt({
      addLocation: request.addLocation,
      parent: request.parent,
      pointer: jsonSchemaPointerWithSegment(pointer, key),
      references: request.references,
    });
    return index === undefined ? [] : [[key, index] as const];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

const arrayChildren = (request: ChildRequest): readonly number[] | undefined => {
  const value = request.schema[request.keyword];
  if (!isJsonArray(value)) return undefined;
  const pointer = jsonSchemaPointerWithSegment(request.parent.pointer, request.keyword);
  const children = value.flatMap((child, index) => {
    if (!isJsonSchemaValue(child)) return [];
    const childIndex = childAt({
      addLocation: request.addLocation,
      parent: request.parent,
      pointer: jsonSchemaPointerWithSegment(pointer, index),
      references: request.references,
    });
    return childIndex === undefined ? [] : [childIndex];
  });
  return children.length === 0 ? undefined : children;
};

const directChild = (request: ChildRequest): number | undefined =>
  isJsonSchemaValue(request.schema[request.keyword])
    ? childAt({
        addLocation: request.addLocation,
        parent: request.parent,
        pointer: jsonSchemaPointerWithSegment(request.parent.pointer, request.keyword),
        references: request.references,
      })
    : undefined;

const finiteContainsBound = (value: JsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const referenceLocation = (
  request: Readonly<{
    location: JsonSchemaResourceLocation;
    reference: JsonValue | undefined;
    references: JsonSchemaReferenceResolver;
  }>,
): JsonSchemaResourceLocation | undefined => {
  if (typeof request.reference !== "string") return undefined;
  const target = request.references.resolve(request.reference, request.location.id);
  return target === undefined ? undefined : request.references.graph.location(target.location);
};

const referenceDescriptor = (
  request: Readonly<{
    addLocation: AddLocation;
    dialect: JsonSchemaDialect;
    location: JsonSchemaResourceLocation;
    references: JsonSchemaReferenceResolver;
    schema: JsonObject;
  }>,
): Pick<RuntimeDescriptor, "dynamicRef" | "recursiveRef" | "ref"> => {
  const refLocation = referenceLocation({
    location: request.location,
    reference: request.schema[jsonSchemaKeywords.ref],
    references: request.references,
  });
  const ref = refLocation === undefined ? undefined : request.addLocation(refLocation);
  const recursiveLocation =
    request.dialect === "draft-2019-09"
      ? referenceLocation({
          location: request.location,
          reference: request.schema[jsonSchemaKeywords.recursiveRef],
          references: request.references,
        })
      : undefined;
  const recursiveReference = request.schema[jsonSchemaKeywords.recursiveRef];
  const recursiveRef =
    recursiveLocation === undefined
      ? undefined
      : {
          dynamic:
            typeof recursiveReference === "string" &&
            isJsonObject(recursiveLocation.schema) &&
            recursiveLocation.schema[jsonSchemaKeywords.recursiveAnchor] === true,
          target: request.addLocation(recursiveLocation),
        };
  const dynamicReference =
    request.dialect === "draft-2020-12" ? request.schema[jsonSchemaKeywords.dynamicRef] : undefined;
  const dynamicAnchor =
    typeof dynamicReference === "string"
      ? decodeJsonSchemaPlainNameFragment(dynamicReference)
      : undefined;
  const dynamicLocation = referenceLocation({
    location: request.location,
    reference: dynamicReference,
    references: request.references,
  });
  const dynamicRef =
    dynamicLocation === undefined
      ? undefined
      : {
          anchor: dynamicAnchor ?? "",
          dynamic:
            dynamicAnchor !== undefined &&
            isJsonObject(dynamicLocation.schema) &&
            dynamicLocation.schema[jsonSchemaKeywords.dynamicAnchor] === dynamicAnchor,
          target: request.addLocation(dynamicLocation),
        };
  return {
    ...(ref === undefined ? {} : { ref }),
    ...(recursiveRef === undefined ? {} : { recursiveRef }),
    ...(dynamicRef === undefined ? {} : { dynamicRef }),
  };
};

const childRequestFor =
  (request: ChildRequestSource) =>
  (keyword: string): ChildRequest => ({
    addLocation: request.addLocation,
    keyword,
    parent: request.location,
    references: request.references,
    schema: request.schema,
  });

const arrayApplicators = (
  request: ApplicatorRequest,
): Omit<RuntimeDescriptor, "resource" | "validator"> => {
  const child = childRequestFor(request);
  const allOf = arrayChildren(child("allOf"));
  const anyOf = arrayChildren(child("anyOf"));
  const oneOf = arrayChildren(child("oneOf"));
  const containsSchema = directChild(child("contains"));
  const prefixItems =
    request.dialect === "draft-2020-12"
      ? arrayChildren(child(jsonSchemaKeywords.prefixItems))
      : arrayChildren(child("items"));
  const itemsValue = request.schema["items"];
  const itemsSchema = isJsonSchemaValue(itemsValue) ? directChild(child("items")) : undefined;
  const additionalItems =
    request.dialect !== "draft-2020-12" && isJsonArray(itemsValue)
      ? directChild(child("additionalItems"))
      : undefined;
  const tupleLength = prefixItems?.length ?? 0;
  const items =
    itemsSchema === undefined
      ? undefined
      : { from: request.dialect === "draft-2020-12" ? tupleLength : 0, schema: itemsSchema };
  const minContains = request.schema[jsonSchemaKeywords.minContains];
  return {
    ...(allOf === undefined ? {} : { allOf }),
    ...(anyOf === undefined ? {} : { anyOf }),
    ...(oneOf === undefined ? {} : { oneOf }),
    ...(prefixItems === undefined ? {} : { prefixItems }),
    ...(items === undefined ? {} : { items }),
    ...(additionalItems === undefined ? {} : { additionalItems }),
    ...(containsSchema === undefined
      ? {}
      : {
          contains: {
            maximum: finiteContainsBound(request.schema[jsonSchemaKeywords.maxContains]),
            minimum: typeof minContains === "number" ? minContains : 1,
            schema: containsSchema,
          },
        }),
  };
};

const objectApplicators = (
  request: ApplicatorRequest,
): Omit<RuntimeDescriptor, "resource" | "validator"> => {
  const child = childRequestFor(request);
  const properties = mappedChildren(child("properties"));
  const patternPropertiesMap = mappedChildren(child("patternProperties"));
  const dependentSchemas = mappedChildren(
    child(request.dialect === "draft-7" ? "dependencies" : "dependentSchemas"),
  );
  const additionalProperties = directChild(child("additionalProperties"));
  const additionalPropertyNames = properties === undefined ? [] : Object.keys(properties);
  const additionalPropertyPatterns =
    patternPropertiesMap === undefined ? [] : Object.keys(patternPropertiesMap);
  return {
    ...(properties === undefined ? {} : { properties }),
    ...(patternPropertiesMap === undefined
      ? {}
      : { patternProperties: Object.entries(patternPropertiesMap) }),
    ...(dependentSchemas === undefined ? {} : { dependentSchemas }),
    ...(additionalProperties === undefined
      ? {}
      : {
          additionalProperties: {
            names: additionalPropertyNames,
            patterns: additionalPropertyPatterns,
            schema: additionalProperties,
          },
        }),
  };
};

const conditionalApplicators = (
  request: ChildRequestSource,
): Omit<RuntimeDescriptor, "resource" | "validator"> => {
  const child = childRequestFor(request);
  const ifSchema = directChild(child("if"));
  const thenSchema = directChild(child("then"));
  const elseSchema = directChild(child("else"));
  const notSchema = directChild(child("not"));
  const propertyNames = directChild(child("propertyNames"));
  const unevaluatedItems = directChild(child(jsonSchemaKeywords.unevaluatedItems));
  const unevaluatedProperties = directChild(child(jsonSchemaKeywords.unevaluatedProperties));
  return {
    ...(ifSchema === undefined ? {} : { ifSchema }),
    ...(thenSchema === undefined ? {} : { thenSchema }),
    ...(elseSchema === undefined ? {} : { elseSchema }),
    ...(notSchema === undefined ? {} : { notSchema }),
    ...(propertyNames === undefined ? {} : { propertyNames }),
    ...(unevaluatedItems === undefined ? {} : { unevaluatedItems }),
    ...(unevaluatedProperties === undefined ? {} : { unevaluatedProperties }),
  };
};

const applicatorDescriptors = (
  request: ApplicatorRequest,
): Omit<RuntimeDescriptor, "resource" | "validator"> => ({
  ...arrayApplicators(request),
  ...objectApplicators(request),
  ...conditionalApplicators(request),
});

const buildDescriptor = (
  request: Readonly<{
    addLocation: AddLocation;
    dialect: JsonSchemaDialect;
    index: number;
    location: JsonSchemaResourceLocation;
    references: JsonSchemaReferenceResolver;
    resource: number;
  }>,
): RuntimeDescriptor => {
  const { schema } = request.location;
  if (!isJsonObject(schema)) return { resource: request.resource, validator: request.index };
  if (isDraft7ReferenceSchema(schema, request.dialect))
    return {
      resource: request.resource,
      validator: request.index,
      ...referenceDescriptor({ ...request, schema }),
    };
  return {
    resource: request.resource,
    validator: request.index,
    ...applicatorDescriptors({ ...request, schema }),
    ...referenceDescriptor({ ...request, schema }),
  };
};

const resourceDescriptor = (
  request: Readonly<{
    addLocation: AddLocation;
    graphResources: readonly JsonSchemaResource[];
    reachableLocations: ReadonlySet<JsonSchemaLocationId>;
    references: JsonSchemaReferenceResolver;
    dialectForLocation: (location: JsonSchemaResourceLocation) => JsonSchemaDialect;
    resource: JsonSchemaResource;
  }>,
): RuntimeResource => {
  const resourceRoot = request.references.graph.location(request.resource.location);
  const recursiveAnchor =
    resourceRoot !== undefined &&
    request.reachableLocations.has(resourceRoot.id) &&
    isJsonObject(resourceRoot.schema) &&
    request.dialectForLocation(resourceRoot) === "draft-2019-09" &&
    resourceRoot.schema[jsonSchemaKeywords.recursiveAnchor] === true
      ? request.addLocation(resourceRoot)
      : undefined;
  const dynamicAnchors = request.references.graph.locations.flatMap((candidate) => {
    const owner = jsonSchemaResourceForLocation(request.graphResources, candidate);
    if (
      owner?.location !== request.resource.location ||
      !request.reachableLocations.has(candidate.id) ||
      request.dialectForLocation(candidate) !== "draft-2020-12" ||
      !isJsonObject(candidate.schema)
    )
      return [];
    const anchor = candidate.schema[jsonSchemaKeywords.dynamicAnchor];
    return typeof anchor === "string" ? ([[anchor, request.addLocation(candidate)]] as const) : [];
  });
  return { dynamicAnchors, ...(recursiveAnchor === undefined ? {} : { recursiveAnchor }) };
};

export const buildRuntimeDescriptors = (
  request: UnevaluatedRuntimeDescriptorRequest,
): RuntimeDescriptorGraph => {
  const descriptors: RuntimeDescriptor[] = [];
  const locations: JsonSchemaResourceLocation[] = [];
  const indexes = new Map<string, number>();
  const resourceIndexes = new Map<JsonSchemaLocationId, number>();
  const resourceOwners: JsonSchemaResource[] = [];
  const graphResources = request.references.graph.resources;
  const resourceIndex = (location: JsonSchemaResourceLocation): number => {
    const owner = jsonSchemaResourceForLocation(graphResources, location);
    if (owner === undefined) throw new Error("JSON Schema location has no owning resource.");
    const existing = resourceIndexes.get(owner.location);
    if (existing !== undefined) return existing;
    const index = resourceOwners.length;
    resourceIndexes.set(owner.location, index);
    resourceOwners.push(owner);
    return index;
  };
  const addLocation: AddLocation = (location) => {
    const existing = indexes.get(location.id);
    if (existing !== undefined) return existing;
    const projectedLocation = { ...location, schema: request.schemaForLocation(location) };
    const index = descriptors.length;
    indexes.set(location.id, index);
    locations.push(projectedLocation);
    const resource = resourceIndex(location);
    descriptors.push({ resource, validator: index });
    descriptors[index] = buildDescriptor({
      addLocation,
      dialect: request.dialectForLocation?.(location) ?? request.dialect,
      index,
      location: projectedLocation,
      references: request.references,
      resource,
    });
    return index;
  };
  const rootLocation = request.references.graph.location(request.references.root.location);
  if (rootLocation === undefined) throw new Error("JSON Schema resource graph has no root.");
  const root = addLocation(rootLocation);
  const resources = resourceOwners.map((resource) =>
    resourceDescriptor({
      addLocation,
      dialectForLocation: (location) => request.dialectForLocation?.(location) ?? request.dialect,
      graphResources,
      reachableLocations: request.reachableLocations,
      references: request.references,
      resource,
    }),
  );
  return { descriptors, locations, resources, root };
};
