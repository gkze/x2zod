import type { LowerChildSchemaRequest, LoweringContext } from "./lower-types";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerSegments } from "./pointer";
import type { JsonSchemaAddress } from "./reference";

const valueDescendingKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.patternProperties,
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.unevaluatedProperties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.additionalItems,
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.contains,
]);

export const childInstanceContext = (request: LowerChildSchemaRequest): LoweringContext => {
  const parent = request.context.references.graph.location(request.parent);
  const parentDepth = parent === undefined ? 0 : jsonSchemaPointerSegments(parent.pointer).length;
  const keyword = jsonSchemaPointerSegments(request.pointer)[parentDepth];
  return keyword !== undefined && valueDescendingKeywords.has(keyword)
    ? { ...request.context, sameValueReferences: new Set<JsonSchemaAddress>() }
    : request.context;
};
