import type { JsonSchemaResource, JsonSchemaResourceLocation } from "./resource-graph";

const containsLocation = (
  resource: JsonSchemaResource,
  location: JsonSchemaResourceLocation,
): boolean =>
  resource.retrievalUri === location.retrievalUri &&
  (resource.pointer === "" ||
    location.pointer === resource.pointer ||
    location.pointer.startsWith(`${resource.pointer}/`));

export const jsonSchemaResourceForLocation = (
  resources: readonly JsonSchemaResource[],
  location: JsonSchemaResourceLocation,
): JsonSchemaResource | undefined => {
  let owner: JsonSchemaResource | undefined = undefined;
  for (const resource of resources)
    if (
      containsLocation(resource, location) &&
      (owner === undefined || resource.pointer.length > owner.pointer.length)
    )
      owner = resource;
  return owner;
};
