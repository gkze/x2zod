import { z } from "zod/v4";

import { createJsonSchemaValueSchema } from "./document";
import type { JsonSchemaValue } from "./document";
import {
  jsonSchemaDialects,
  jsonSchemaInertKeywordValueTypes,
  jsonSchemaKeywordPolicy,
  jsonSchemaSourceProfiles,
  jsonSchemaUnknownKeywordPolicies,
  jsonSchemaValidators,
} from "./metadata";
import type {
  JsonSchemaDialect,
  JsonSchemaInertKeywords,
  JsonSchemaSourceProfile,
  JsonSchemaUnknownKeywordPolicy,
  JsonSchemaValidator,
} from "./metadata";
import { normalizeJsonSchemaRetrievalUri } from "./retrieval-uri";

type JsonSchemaCLIOptionMetadata = Readonly<{
  description: string;
  long?: string | undefined;
  short: string;
  valueMode?: "boolean-map" | "json-file-map" | "string-array" | "string-map" | undefined;
  valueName?: string | undefined;
}>;

export { jsonSchemaInputPluginKind } from "./metadata";
export type {
  JsonSchemaDialect,
  JsonSchemaInertKeywords,
  JsonSchemaInertKeywordValueType,
  JsonSchemaInputPluginKind,
  JsonSchemaSourceProfile,
  JsonSchemaUnknownKeywordPolicy,
  JsonSchemaValidator,
} from "./metadata";

type JsonSchemaInputPluginOptionsOutput = Readonly<{
  annotationKeywords: JsonSchemaAnnotationKeywords;
  dialect?: JsonSchemaDialect | undefined;
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  inertKeywords: JsonSchemaInertKeywords;
  sourceProfile: JsonSchemaSourceProfile;
  validator: JsonSchemaValidator;
  unknownKeywords: JsonSchemaUnknownKeywordPolicy;
}>;

type JsonSchemaInputPluginOptionsInputValue = Readonly<{
  annotationKeywords?: JsonSchemaAnnotationKeywordsInput | undefined;
  dialect?: JsonSchemaDialect | undefined;
  externalSchemas?: Readonly<Record<string, JsonSchemaValue>> | undefined;
  inertKeywords?: JsonSchemaInertKeywords | undefined;
  sourceProfile?: JsonSchemaSourceProfile | undefined;
  validator?: JsonSchemaValidator | undefined;
  unknownKeywords?: JsonSchemaUnknownKeywordPolicy | undefined;
}>;

const withCLI = <TSchema extends z.ZodType>(
  schema: TSchema,
  metadata: JsonSchemaCLIOptionMetadata,
): TSchema => {
  const existingMetadata = schema.meta();
  return schema.meta({ ...existingMetadata, x2zodCLI: metadata } as never);
};

const jsonSchemaDialectSchemaValue: z.ZodType<JsonSchemaDialect, JsonSchemaDialect> =
  z.enum(jsonSchemaDialects);
export const jsonSchemaDialectSchema: z.ZodType<JsonSchemaDialect, JsonSchemaDialect> =
  jsonSchemaDialectSchemaValue;

const jsonSchemaValidatorSchemaValue: z.ZodType<JsonSchemaValidator, JsonSchemaValidator> =
  z.enum(jsonSchemaValidators);
export const jsonSchemaValidatorSchema: z.ZodType<JsonSchemaValidator, JsonSchemaValidator> =
  jsonSchemaValidatorSchemaValue;

const jsonSchemaSourceProfileSchemaValue: z.ZodType<
  JsonSchemaSourceProfile,
  JsonSchemaSourceProfile
> = z.enum(jsonSchemaSourceProfiles);
export const jsonSchemaSourceProfileSchema: z.ZodType<
  JsonSchemaSourceProfile,
  JsonSchemaSourceProfile
> = jsonSchemaSourceProfileSchemaValue;

const jsonSchemaUnknownKeywordPolicySchemaValue: z.ZodType<
  JsonSchemaUnknownKeywordPolicy,
  JsonSchemaUnknownKeywordPolicy
> = z.enum(jsonSchemaUnknownKeywordPolicies);
export const jsonSchemaUnknownKeywordPolicySchema: z.ZodType<
  JsonSchemaUnknownKeywordPolicy,
  JsonSchemaUnknownKeywordPolicy
> = jsonSchemaUnknownKeywordPolicySchemaValue;

// Keep the public option input typed as JsonSchemaValue.
// The document parser's schema intentionally accepts unknown raw input.
const jsonSchemaInputValueSchema: z.ZodType<JsonSchemaValue, JsonSchemaValue> =
  createJsonSchemaValueSchema<JsonSchemaValue>();
export type JsonSchemaAnnotationKeywords = Readonly<Record<string, boolean>>;
export type JsonSchemaAnnotationKeywordsInput = Readonly<Record<string, boolean>>;

const annotationKeywordsSchemaValue: z.ZodType<
  JsonSchemaAnnotationKeywords,
  JsonSchemaAnnotationKeywordsInput
> = z
  .record(z.string().min(1), z.boolean())
  .readonly()
  .superRefine((keywords, context) => {
    for (const keyword of Object.keys(keywords))
      if (keyword !== "description")
        context.addIssue({
          code: "custom",
          message: `Unsupported annotation keyword: ${keyword}. Only description is recognized.`,
          path: [keyword],
        });
  });
export const jsonSchemaAnnotationKeywordsSchema: z.ZodType<
  JsonSchemaAnnotationKeywords,
  JsonSchemaAnnotationKeywordsInput
> = annotationKeywordsSchemaValue;
const externalSchemasSchemaValue: z.ZodType<
  Readonly<Record<string, JsonSchemaValue>>,
  Readonly<Record<string, JsonSchemaValue>>
> = z
  .record(z.string(), jsonSchemaInputValueSchema)
  .readonly()
  .superRefine((schemas, context) => {
    for (const uri of Object.keys(schemas))
      if (!normalizeJsonSchemaRetrievalUri(uri, "External schema registry key").ok)
        context.addIssue({
          code: "custom",
          message:
            "External schema registry keys must be valid absolute, fragmentless retrieval URIs.",
          path: [uri],
        });
  });

const inertKeywordsSchemaValue: z.ZodType<JsonSchemaInertKeywords, JsonSchemaInertKeywords> = z
  .record(z.string().min(1), z.enum(jsonSchemaInertKeywordValueTypes))
  .readonly()
  .superRefine((keywords, context) => {
    for (const keyword of Object.keys(keywords))
      if (keyword.startsWith("$"))
        context.addIssue({
          code: "custom",
          message: "Inert keyword names must not use the JSON Schema $-reserved namespace.",
          path: [keyword],
        });
      else if (jsonSchemaKeywordPolicy(keyword) === "supported")
        context.addIssue({
          code: "custom",
          message: "Standard JSON Schema keywords cannot be configured as inert metadata.",
          path: [keyword],
        });
  });

const jsonSchemaInputPluginOptionsSchemaValue: z.ZodType<
  JsonSchemaInputPluginOptionsOutput,
  JsonSchemaInputPluginOptionsInputValue
> = z
  .strictObject({
    annotationKeywords: withCLI(annotationKeywordsSchemaValue.default({}), {
      description: "Projection policy for recognized JSON Schema annotation keywords.",
      long: "--annotation-keywords",
      short: "-a",
      valueMode: "boolean-map",
      valueName: "NAME=BOOLEAN",
    }),
    dialect: withCLI(jsonSchemaDialectSchema.exactOptional(), {
      description: "JSON Schema dialect override; inferred from $schema, otherwise 2020-12.",
      short: "-d",
      valueName: "DIALECT",
    }),
    externalSchemas: withCLI(externalSchemasSchemaValue.default({}), {
      description: "External JSON Schema resource mapping.",
      long: "--external-schema",
      short: "-E",
      valueMode: "json-file-map",
      valueName: "ID=FILE",
    }),
    inertKeywords: withCLI(inertKeywordsSchemaValue.default({}), {
      description: "Exact custom JSON Schema keywords to accept as typed inert metadata.",
      long: "--inert-keyword",
      short: "-K",
      valueMode: "string-map",
      valueName: "NAME=TYPE",
    }),
    sourceProfile: withCLI(jsonSchemaSourceProfileSchema.default("none"), {
      description: "JSON Schema source compatibility profile.",
      short: "-p",
      valueName: "PROFILE",
    }),
    validator: withCLI(jsonSchemaValidatorSchema.default("ajv"), {
      description: "JSON Schema validator policy.",
      short: "-v",
      valueName: "VALIDATOR",
    }),
    unknownKeywords: withCLI(jsonSchemaUnknownKeywordPolicySchema.default("warn"), {
      description: "Unknown keyword policy: reject, warn, or ignore vendor extensions.",
      short: "-u",
      valueName: "POLICY",
    }),
  })
  .readonly();
export const jsonSchemaInputPluginOptionsSchema: z.ZodType<
  JsonSchemaInputPluginOptionsOutput,
  JsonSchemaInputPluginOptionsInputValue
> = jsonSchemaInputPluginOptionsSchemaValue;

export type JsonSchemaInputPluginOptions = z.output<typeof jsonSchemaInputPluginOptionsSchemaValue>;
export type ResolvedJsonSchemaInputPluginOptions = Omit<JsonSchemaInputPluginOptions, "dialect"> &
  Readonly<{ dialect: JsonSchemaDialect }>;
export type JsonSchemaInputPluginOptionsInput = z.input<
  typeof jsonSchemaInputPluginOptionsSchemaValue
>;
