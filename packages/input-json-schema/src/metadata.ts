export const jsonSchemaInputPluginKind = "json-schema" as const;

export const jsonSchemaDialects = ["draft-2020-12", "draft-2019-09", "draft-7"] as const;
export const jsonSchemaValidators = ["ajv", "none"] as const;
export const jsonSchemaSourceProfiles = ["none", "opencode", "schemastore"] as const;

export type JsonSchemaDialect = (typeof jsonSchemaDialects)[number];
export type JsonSchemaValidator = (typeof jsonSchemaValidators)[number];
export type JsonSchemaSourceProfile = (typeof jsonSchemaSourceProfiles)[number];
export type JsonSchemaInputPluginKind = typeof jsonSchemaInputPluginKind;
export type JsonSchemaKeywordPolicy = "supported" | "unknown";

export const jsonSchemaKeywords = {
  additionalProperties: "additionalProperties",
  additionalItems: "additionalItems",
  anchor: "$anchor",
  allOf: "allOf",
  allowComments: "allowComments",
  allowTrailingCommas: "allowTrailingCommas",
  anyOf: "anyOf",
  comment: "$comment",
  contains: "contains",
  contentEncoding: "contentEncoding",
  contentMediaType: "contentMediaType",
  contentSchema: "contentSchema",
  const: "const",
  default: "default",
  dependentRequired: "dependentRequired",
  dependentSchemas: "dependentSchemas",
  dependencies: "dependencies",
  deprecated: "deprecated",
  definitions: "definitions",
  description: "description",
  dollarDefs: "$defs",
  dynamicAnchor: "$dynamicAnchor",
  dynamicRef: "$dynamicRef",
  recursiveAnchor: "$recursiveAnchor",
  recursiveRef: "$recursiveRef",
  else: "else",
  enum: "enum",
  examples: "examples",
  exclusiveMaximum: "exclusiveMaximum",
  exclusiveMinimum: "exclusiveMinimum",
  format: "format",
  id: "$id",
  if: "if",
  items: "items",
  maximum: "maximum",
  maxContains: "maxContains",
  maxItems: "maxItems",
  maxLength: "maxLength",
  maxProperties: "maxProperties",
  minimum: "minimum",
  minContains: "minContains",
  minItems: "minItems",
  minLength: "minLength",
  minProperties: "minProperties",
  multipleOf: "multipleOf",
  not: "not",
  oneOf: "oneOf",
  pattern: "pattern",
  patternProperties: "patternProperties",
  prefixItems: "prefixItems",
  properties: "properties",
  propertyNames: "propertyNames",
  readOnly: "readOnly",
  ref: "$ref",
  required: "required",
  schema: "$schema",
  thenKeyword: "then",
  title: "title",
  type: "type",
  unevaluatedItems: "unevaluatedItems",
  unevaluatedProperties: "unevaluatedProperties",
  uniqueItems: "uniqueItems",
  vocabulary: "$vocabulary",
  writeOnly: "writeOnly",
} as const;

const jsonSchemaAnchorName = /^[A-Za-z_][-A-Za-z0-9._]*$/u;

export const isValidJsonSchemaAnchorName = (name: string): boolean =>
  jsonSchemaAnchorName.test(name);

export const jsonSchemaAnchorKeywordsForDialect = (dialect: JsonSchemaDialect): readonly string[] =>
  dialect === "draft-7"
    ? []
    : [
        jsonSchemaKeywords.anchor,
        ...(dialect === "draft-2020-12" ? [jsonSchemaKeywords.dynamicAnchor] : []),
      ];

export const jsonSchemaReferenceKeywordsForDialect = (
  dialect: JsonSchemaDialect,
): readonly string[] => [
  jsonSchemaKeywords.ref,
  ...(dialect === "draft-2020-12" ? [jsonSchemaKeywords.dynamicRef] : []),
  ...(dialect === "draft-2019-09" ? [jsonSchemaKeywords.recursiveRef] : []),
];

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
]);

export const jsonSchemaSupportedKeywords: ReadonlySet<string> = new Set<string>([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.additionalItems,
  jsonSchemaKeywords.contentEncoding,
  jsonSchemaKeywords.contentMediaType,
  jsonSchemaKeywords.contentSchema,
  jsonSchemaKeywords.additionalProperties,
  jsonSchemaKeywords.allOf,
  jsonSchemaKeywords.anyOf,
  jsonSchemaKeywords.const,
  jsonSchemaKeywords.dependentRequired,
  jsonSchemaKeywords.dependentSchemas,
  jsonSchemaKeywords.dependencies,
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
  jsonSchemaKeywords.else,
  jsonSchemaKeywords.contains,
  jsonSchemaKeywords.definitions,
  jsonSchemaKeywords.dollarDefs,
  jsonSchemaKeywords.enum,
  jsonSchemaKeywords.exclusiveMaximum,
  jsonSchemaKeywords.exclusiveMinimum,
  jsonSchemaKeywords.items,
  jsonSchemaKeywords.if,
  jsonSchemaKeywords.maximum,
  jsonSchemaKeywords.maxContains,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.maxLength,
  jsonSchemaKeywords.maxProperties,
  jsonSchemaKeywords.minimum,
  jsonSchemaKeywords.minContains,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.minLength,
  jsonSchemaKeywords.minProperties,
  jsonSchemaKeywords.multipleOf,
  jsonSchemaKeywords.not,
  jsonSchemaKeywords.oneOf,
  jsonSchemaKeywords.pattern,
  jsonSchemaKeywords.patternProperties,
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.properties,
  jsonSchemaKeywords.propertyNames,
  jsonSchemaKeywords.ref,
  jsonSchemaKeywords.recursiveAnchor,
  jsonSchemaKeywords.recursiveRef,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.thenKeyword,
  jsonSchemaKeywords.type,
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.unevaluatedProperties,
  jsonSchemaKeywords.uniqueItems,
]);

export const jsonSchemaValidationKeywords: ReadonlySet<string> = new Set<string>([
  jsonSchemaKeywords.const,
  jsonSchemaKeywords.dependentRequired,
  jsonSchemaKeywords.enum,
  jsonSchemaKeywords.exclusiveMaximum,
  jsonSchemaKeywords.exclusiveMinimum,
  jsonSchemaKeywords.maximum,
  jsonSchemaKeywords.maxContains,
  jsonSchemaKeywords.maxItems,
  jsonSchemaKeywords.maxLength,
  jsonSchemaKeywords.maxProperties,
  jsonSchemaKeywords.minimum,
  jsonSchemaKeywords.minContains,
  jsonSchemaKeywords.minItems,
  jsonSchemaKeywords.minLength,
  jsonSchemaKeywords.minProperties,
  jsonSchemaKeywords.multipleOf,
  jsonSchemaKeywords.pattern,
  jsonSchemaKeywords.required,
  jsonSchemaKeywords.type,
  jsonSchemaKeywords.uniqueItems,
]);

export const jsonSchemaSourceProfileMetadataKeywords: Readonly<
  Record<JsonSchemaSourceProfile, ReadonlySet<string>>
> = {
  none: new Set<string>(),
  opencode: new Set<string>([
    jsonSchemaKeywords.definitions,
    jsonSchemaKeywords.dollarDefs,
    jsonSchemaKeywords.allowComments,
    jsonSchemaKeywords.allowTrailingCommas,
    "ref",
  ]),
  schemastore: new Set<string>(["tsType", "x-intellij-language-injection"]),
};

export const opencodeModelRef = "https://models.dev/model-schema.json#/$defs/Model";

export const jsonSchemaAnyOfAllowedSiblingKeywords: ReadonlySet<string> = new Set<string>([
  ...jsonSchemaMetadataKeywords,
  jsonSchemaKeywords.definitions,
  jsonSchemaKeywords.dollarDefs,
]);

export const jsonSchemaKeywordPolicy = (keyword: string): JsonSchemaKeywordPolicy =>
  jsonSchemaSupportedKeywords.has(keyword) ? "supported" : "unknown";

const draft7OnlyKeywords: ReadonlySet<string> = new Set([jsonSchemaKeywords.dependencies]);
const pre2020Keywords: ReadonlySet<string> = new Set([jsonSchemaKeywords.additionalItems]);
const draft2019PlusKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.anchor,
  jsonSchemaKeywords.vocabulary,
  jsonSchemaKeywords.dependentRequired,
  jsonSchemaKeywords.dependentSchemas,
  jsonSchemaKeywords.unevaluatedProperties,
  jsonSchemaKeywords.unevaluatedItems,
  jsonSchemaKeywords.contentSchema,
  jsonSchemaKeywords.minContains,
  jsonSchemaKeywords.maxContains,
]);
const draft2020OnlyKeywords: ReadonlySet<string> = new Set([
  jsonSchemaKeywords.prefixItems,
  jsonSchemaKeywords.dynamicAnchor,
  jsonSchemaKeywords.dynamicRef,
]);

export const jsonSchemaKeywordPolicyForDialect = (
  keyword: string,
  dialect: JsonSchemaDialect,
): JsonSchemaKeywordPolicy => {
  if (keyword === jsonSchemaKeywords.definitions && dialect !== "draft-7") return "unknown";
  if (keyword === jsonSchemaKeywords.dollarDefs && dialect === "draft-7") return "unknown";
  if (draft7OnlyKeywords.has(keyword) && dialect !== "draft-7") return "unknown";
  if (pre2020Keywords.has(keyword) && dialect === "draft-2020-12") return "unknown";
  if (draft2019PlusKeywords.has(keyword) && dialect === "draft-7") return "unknown";
  if (
    (keyword === jsonSchemaKeywords.recursiveAnchor ||
      keyword === jsonSchemaKeywords.recursiveRef) &&
    dialect !== "draft-2019-09"
  )
    return "unknown";
  if (draft2020OnlyKeywords.has(keyword) && dialect !== "draft-2020-12") return "unknown";
  return jsonSchemaKeywordPolicy(keyword);
};
