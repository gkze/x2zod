export const jsonSchemaInputPluginKind = "json-schema" as const;

export const jsonSchemaDialects = ["draft-2020-12", "draft-7"] as const;
export const jsonSchemaValidators = ["ajv", "none"] as const;
export const jsonSchemaSourceProfiles = ["none", "opencode"] as const;

export type JsonSchemaDialect = (typeof jsonSchemaDialects)[number];
export type JsonSchemaValidator = (typeof jsonSchemaValidators)[number];
export type JsonSchemaSourceProfile = (typeof jsonSchemaSourceProfiles)[number];
export type JsonSchemaInputPluginKind = typeof jsonSchemaInputPluginKind;
export type JsonSchemaKeywordPolicy = "supported" | "unknown" | "unsupported";

export const jsonSchemaKeywords = {
  additionalProperties: "additionalProperties",
  anchor: "$anchor",
  anyOf: "anyOf",
  comment: "$comment",
  const: "const",
  default: "default",
  definitions: "definitions",
  description: "description",
  dollarDefs: "$defs",
  dynamicAnchor: "$dynamicAnchor",
  dynamicRef: "$dynamicRef",
  enum: "enum",
  exclusiveMaximum: "exclusiveMaximum",
  exclusiveMinimum: "exclusiveMinimum",
  format: "format",
  id: "$id",
  items: "items",
  maximum: "maximum",
  maxItems: "maxItems",
  minimum: "minimum",
  minItems: "minItems",
  pattern: "pattern",
  prefixItems: "prefixItems",
  properties: "properties",
  ref: "$ref",
  required: "required",
  schema: "$schema",
  title: "title",
  type: "type",
  vocabulary: "$vocabulary",
} as const;

export const jsonSchemaMetadataKeywords: ReadonlySet<string> = new Set<string>([
  jsonSchemaKeywords.anchor,
  jsonSchemaKeywords.comment,
  jsonSchemaKeywords.default,
  jsonSchemaKeywords.description,
  jsonSchemaKeywords.format,
  jsonSchemaKeywords.id,
  jsonSchemaKeywords.schema,
  jsonSchemaKeywords.title,
  jsonSchemaKeywords.vocabulary,
]);

export const jsonSchemaSupportedKeywords: ReadonlySet<string> = new Set<string>([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.anyOf,
  jsonSchemaKeywords.const,
  jsonSchemaKeywords.definitions,
  jsonSchemaKeywords.dollarDefs,
  jsonSchemaKeywords.enum,
  jsonSchemaKeywords.exclusiveMaximum,
  jsonSchemaKeywords.exclusiveMinimum,
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.maximum,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.minimum,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.pattern,
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.ref,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.type,
]);

export const jsonSchemaUnsupportedStandardKeywords: ReadonlySet<string> = new Set<string>([
  "allOf",
  "contains",
  "dependentRequired",
  "dependentSchemas",
  "else",
  "if",
  "maxContains",
  "maxLength",
  "maxProperties",
  "minContains",
  "minLength",
  "minProperties",
  "multipleOf",
  "not",
  "oneOf",
  "patternProperties",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
  "uniqueItems",
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
]);

export const opencodeSourceProfileMetadataKeywords: ReadonlySet<string> = new Set<string>([
  "allowComments",
  "allowTrailingCommas",
  "ref",
]);

export const opencodeModelRef = "https://models.dev/model-schema.json#/$defs/Model";

export const jsonSchemaAnyOfAllowedSiblingKeywords: ReadonlySet<string> = new Set<string>([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.definitions,
  jsonSchemaKeywords.dollarDefs,
]);

export const jsonSchemaKeywordPolicy = (keyword: string): JsonSchemaKeywordPolicy => {
  if (jsonSchemaSupportedKeywords.has(keyword)) return "supported";
  return jsonSchemaUnsupportedStandardKeywords.has(keyword) ? "unsupported" : "unknown";
};
