import { isJsonArray } from "./document";
import type { JsonObject } from "./document";
import { jsonSchemaKeywords } from "./metadata";

export const jsonSchemaArrayNeedsBroadRuntimeProjection = (schema: JsonObject): boolean => {
  if (isJsonArray(schema[jsonSchemaKeywords.items])) return true;

  const prefixItems = schema[jsonSchemaKeywords.prefixItems];
  if (!isJsonArray(prefixItems)) return false;

  return (
    prefixItems.length === 0 ||
    schema[jsonSchemaKeywords.minItems] !== prefixItems.length ||
    schema[jsonSchemaKeywords.maxItems] !== prefixItems.length ||
    schema[jsonSchemaKeywords.uniqueItems] === true
  );
};
