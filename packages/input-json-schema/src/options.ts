import { z } from "zod/v4";

import { createJsonSchemaValueSchema } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDialects, jsonSchemaSourceProfiles, jsonSchemaValidators } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile, JsonSchemaValidator } from "./metadata";
import { normalizeJsonSchemaRetrievalUri } from "./retrieval-uri";

type JsonSchemaCLIOptionMetadata = Readonly<{
  description: string;
  long?: string | undefined;
  short: string;
  valueMode?: "json-file-map" | "string-array" | undefined;
  valueName?: string | undefined;
}>;

export { jsonSchemaInputPluginKind } from "./metadata";
export type {
  JsonSchemaDialect,
  JsonSchemaInputPluginKind,
  JsonSchemaSourceProfile,
  JsonSchemaValidator,
} from "./metadata";

type JsonSchemaInputPluginOptionsOutput = Readonly<{
  dialect?: JsonSchemaDialect | undefined;
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  sourceProfile: JsonSchemaSourceProfile;
  validator: JsonSchemaValidator;
}>;

type JsonSchemaInputPluginOptionsInputValue = Readonly<{
  dialect?: JsonSchemaDialect | undefined;
  externalSchemas?: Readonly<Record<string, JsonSchemaValue>> | undefined;
  sourceProfile?: JsonSchemaSourceProfile | undefined;
  validator?: JsonSchemaValidator | undefined;
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

// Keep the public option input typed as JsonSchemaValue.
// The document parser's schema intentionally accepts unknown raw input.
const jsonSchemaInputValueSchema: z.ZodType<JsonSchemaValue, JsonSchemaValue> =
  createJsonSchemaValueSchema<JsonSchemaValue>();
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

const jsonSchemaInputPluginOptionsSchemaValue: z.ZodType<
  JsonSchemaInputPluginOptionsOutput,
  JsonSchemaInputPluginOptionsInputValue
> = z
  .strictObject({
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
