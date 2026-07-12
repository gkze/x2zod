export const jsonSchemaInputPluginKind = "json-schema" as const;

export const jsonSchemaDialects = ["draft-2020-12", "draft-2019-09", "draft-7"] as const;
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
  allOf: "allOf",
  allowComments: "allowComments",
  allowTrailingCommas: "allowTrailingCommas",
  anyOf: "anyOf",
  comment: "$comment",
  const: "const",
  default: "default",
  deprecated: "deprecated",
  definitions: "definitions",
  description: "description",
  dollarDefs: "$defs",
  dynamicAnchor: "$dynamicAnchor",
  dynamicRef: "$dynamicRef",
  enum: "enum",
  examples: "examples",
  exclusiveMaximum: "exclusiveMaximum",
  exclusiveMinimum: "exclusiveMinimum",
  format: "format",
  id: "$id",
  items: "items",
  maximum: "maximum",
  maxItems: "maxItems",
  maxLength: "maxLength",
  minimum: "minimum",
  minItems: "minItems",
  minLength: "minLength",
  not: "not",
  oneOf: "oneOf",
  pattern: "pattern",
  prefixItems: "prefixItems",
  properties: "properties",
  propertyNames: "propertyNames",
  readOnly: "readOnly",
  ref: "$ref",
  required: "required",
  schema: "$schema",
  title: "title",
  type: "type",
  unevaluatedProperties: "unevaluatedProperties",
  vocabulary: "$vocabulary",
  writeOnly: "writeOnly",
} as const;

export const jsonSchemaMetadataKeywords: ReadonlySet<string> = new Set<string>([
  jsonSchemaKeywords.anchor,
  jsonSchemaKeywords.comment,
  jsonSchemaKeywords.default,
  jsonSchemaKeywords.deprecated,
  jsonSchemaKeywords.description,
  jsonSchemaKeywords.examples,
  jsonSchemaKeywords.format,
  jsonSchemaKeywords.id,
  jsonSchemaKeywords.readOnly,
  jsonSchemaKeywords.schema,
  jsonSchemaKeywords.title,
  jsonSchemaKeywords.vocabulary,
  jsonSchemaKeywords.writeOnly,
  jsonSchemaKeywords.allowComments,
  jsonSchemaKeywords.allowTrailingCommas,
]);

export const jsonSchemaSupportedKeywords: ReadonlySet<string> = new Set<string>([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.allOf,
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
  jsonSchemaKeywords.maxLength,
  jsonSchemaKeywords.minimum,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.minLength,
  jsonSchemaKeywords.not,
  jsonSchemaKeywords.oneOf,
  jsonSchemaKeywords.pattern,
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.ref,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.type,
  jsonSchemaKeywords.unevaluatedProperties,
]);

export const jsonSchemaUnsupportedStandardKeywords: ReadonlySet<string> = new Set<string>([
  "contains",
  "dependentRequired",
  "dependentSchemas",
  "else",
  "if",
  "maxContains",
  "maxProperties",
  "minContains",
  "minProperties",
  "multipleOf",
  "patternProperties",
  "then",
  "unevaluatedItems",
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
