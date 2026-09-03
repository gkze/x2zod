import type { JsonPointer } from "@x2zod/core";

import { isJsonObject } from "./document";
import type { JsonValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerReference } from "./pointer-reference";
import type { JsonSchemaReferenceResolver, ResolvedJsonSchemaReference } from "./reference";
import { decodeJsonSchemaPlainNameFragment } from "./retrieval-uri";

const scopedResourceKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
  jsonSchemaKeywords.recursiveAnchor,
  jsonSchemaKeywords.recursiveRef,
]);

type ScopedReferenceNormalizationRequest = Readonly<{
  emittedPointer: (pointer: JsonPointer) => JsonPointer;
  keyword: string;
  location: ResolvedJsonSchemaReference["location"];
  reference: string;
  references: JsonSchemaReferenceResolver;
  rootPointer: JsonPointer;
}>;

export const normalizeScopedReference = ({
  emittedPointer,
  keyword,
  location,
  reference,
  references,
  rootPointer,
}: ScopedReferenceNormalizationRequest): JsonValue => {
  const target = references.resolve(reference, location);
  const sourceLocation = references.graph.location(location);
  const targetLocation =
    target === undefined ? undefined : references.graph.location(target.location);
  if (target === undefined || sourceLocation === undefined || targetLocation === undefined)
    return reference;
  const targetReference = jsonSchemaPointerReference({
    local: sourceLocation.retrievalUri === targetLocation.retrievalUri,
    pointer: emittedPointer(target.pointer),
    retrievalUri: targetLocation.retrievalUri,
    rootPointer,
  });
  const anchor = decodeJsonSchemaPlainNameFragment(reference);
  return keyword === jsonSchemaKeywords.dynamicRef && anchor !== undefined
    ? { anchor, documentPointer: true, reference: targetReference }
    : { documentPointer: true, reference: targetReference };
};

type ScopedResourceRequest = Readonly<{
  reachableLocations?: ReadonlySet<string> | undefined;
  references: JsonSchemaReferenceResolver;
}>;

export const retainedScopedResourceUris = ({
  reachableLocations,
  references,
}: ScopedResourceRequest): ReadonlySet<string> => {
  const resourceUris = new Set<string>();
  for (const location of references.graph.locations)
    if (
      (reachableLocations === undefined || reachableLocations.has(location.id)) &&
      isJsonObject(location.schema)
    ) {
      if (Object.keys(location.schema).some((keyword) => scopedResourceKeywords.has(keyword)))
        resourceUris.add(location.resourceUri);
      for (const keyword of [jsonSchemaKeywords.dynamicRef, jsonSchemaKeywords.recursiveRef]) {
        const reference = location.schema[keyword];
        const target =
          typeof reference === "string" ? references.resolve(reference, location.id) : undefined;
        const targetResourceUri =
          target === undefined
            ? undefined
            : references.graph.location(target.location)?.resourceUri;
        if (targetResourceUri !== undefined) resourceUris.add(targetResourceUri);
      }
    }
  return resourceUris;
};
