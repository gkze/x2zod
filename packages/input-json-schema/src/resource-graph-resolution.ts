import { createDiagnostic, err, jsonPointerSchema, ok } from "@x2zod/core";
import type { JsonPointer } from "@x2zod/core";

import { jsonSchemaPointerSegments, jsonSchemaPointerWithSegment } from "./pointer";
import type {
  JsonSchemaLocationId,
  JsonSchemaResourceGraph,
  JsonSchemaResourceLocation,
  ResolveJsonSchemaGraphReferenceRequest,
  ResolvedJsonSchemaGraphReference,
} from "./resource-graph";
import {
  decodeJsonSchemaUriFragment,
  jsonSchemaReferenceTargetAddress,
  resolveJsonSchemaUri,
  splitJsonSchemaUri,
} from "./retrieval-uri";
import { compareCodeUnits } from "./string-order";

type ProjectedReference = Readonly<{
  absoluteUri: string;
  fragment?: string | undefined;
  localFragment: boolean;
  resourceUri: string;
  source: JsonSchemaResourceLocation;
}>;

const locationPointerWithinResource = (
  resourcePointer: JsonPointer,
  fragmentPointer: JsonPointer,
): JsonPointer => {
  let pointer = resourcePointer;
  for (const segment of jsonSchemaPointerSegments(fragmentPointer))
    pointer = jsonSchemaPointerWithSegment(pointer, segment);
  return pointer;
};

type ProjectedTargetRequest = Readonly<{
  locations: ReadonlyMap<JsonSchemaLocationId, JsonSchemaResourceLocation>;
  projection: ProjectedReference;
  target: string;
  targetLocations: ReadonlyMap<string, ReadonlySet<JsonSchemaLocationId>>;
}>;

const projectedTargetIds = ({
  locations,
  projection,
  target,
  targetLocations,
}: ProjectedTargetRequest): readonly JsonSchemaLocationId[] => {
  const targets = [...(targetLocations.get(target) ?? [])].toSorted(compareCodeUnits);
  return projection.localFragment
    ? targets.filter((id) => {
        const location = locations.get(id);
        return (
          location?.resourceUri === projection.source.resourceUri &&
          location.retrievalUri === projection.source.retrievalUri
        );
      })
    : targets;
};

export const createJsonSchemaGraphReferenceResolvers = (
  locations: ReadonlyMap<JsonSchemaLocationId, JsonSchemaResourceLocation>,
  targetLocations: ReadonlyMap<string, ReadonlySet<JsonSchemaLocationId>>,
): Pick<JsonSchemaResourceGraph, "resolve" | "resolveUnique"> => {
  const project = ({
    from,
    reference,
  }: ResolveJsonSchemaGraphReferenceRequest): ProjectedReference | undefined => {
    const source = locations.get(from);
    if (source === undefined) return undefined;
    const absoluteUri = resolveJsonSchemaUri(source.baseUri, reference);
    return {
      absoluteUri,
      localFragment: reference === "" || reference.startsWith("#"),
      source,
      ...splitJsonSchemaUri(absoluteUri),
    };
  };
  const targetsFor = (
    projection: ProjectedReference,
    target: string,
  ): readonly JsonSchemaLocationId[] =>
    projectedTargetIds({ locations, projection, target, targetLocations });
  const resolveProjected = (
    projection: ProjectedReference,
  ): readonly ResolvedJsonSchemaGraphReference[] => {
    const resourceTargets = targetsFor(projection, projection.resourceUri);
    const decodedFragment =
      projection.fragment === undefined
        ? undefined
        : decodeJsonSchemaUriFragment(projection.fragment).value;
    let targets = resourceTargets;
    if (decodedFragment !== undefined && decodedFragment !== "")
      if (decodedFragment.startsWith("/")) {
        const fragmentPointer = jsonPointerSchema.safeParse(decodedFragment);
        targets = fragmentPointer.success
          ? resourceTargets.flatMap((id) => {
              const resource = locations.get(id);
              if (resource === undefined) return [];
              const pointer = locationPointerWithinResource(resource.pointer, fragmentPointer.data);
              const target = locations.get(`${resource.retrievalUri}#${pointer}`);
              return target === undefined ? [] : [target.id];
            })
          : [];
      } else
        targets = targetsFor(
          projection,
          jsonSchemaReferenceTargetAddress(projection.resourceUri, decodedFragment),
        );
    return targets.flatMap((id) => {
      const location = locations.get(id);
      return location === undefined ? [] : [{ location, resolvedUri: projection.absoluteUri }];
    });
  };
  const resolve = (
    request: ResolveJsonSchemaGraphReferenceRequest,
  ): ResolvedJsonSchemaGraphReference | undefined => {
    const projection = project(request);
    return projection === undefined ? undefined : resolveProjected(projection)[0];
  };
  return {
    resolve,
    resolveUnique: (request) => {
      const projection = project(request);
      if (projection === undefined) return ok(null);
      const decodedFragment =
        projection.fragment === undefined
          ? undefined
          : decodeJsonSchemaUriFragment(projection.fragment).value;
      let ambiguity =
        targetsFor(projection, projection.resourceUri).length > 1
          ? projection.resourceUri
          : undefined;
      if (
        ambiguity === undefined &&
        decodedFragment !== undefined &&
        !decodedFragment.startsWith("/") &&
        targetsFor(
          projection,
          jsonSchemaReferenceTargetAddress(projection.resourceUri, decodedFragment),
        ).length > 1
      )
        ambiguity = jsonSchemaReferenceTargetAddress(projection.resourceUri, decodedFragment);
      return ambiguity === undefined
        ? ok(resolveProjected(projection)[0] ?? null)
        : err(
            createDiagnostic({
              code: "invalid_schema_document",
              message: `JSON Schema resource identifier is not unique: ${ambiguity}.`,
            }),
          );
    },
  };
};
