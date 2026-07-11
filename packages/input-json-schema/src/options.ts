import { z } from "zod/v4";

import { jsonSchemaValueSchema } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDialects, jsonSchemaSourceProfiles, jsonSchemaValidators } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile, JsonSchemaValidator } from "./metadata";

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
  dialect: JsonSchemaDialect;
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
  z.custom<JsonSchemaValue>((value) => jsonSchemaValueSchema.safeParse(value).success);

const externalSchemasSchemaValue: z.ZodType<
  Readonly<Record<string, JsonSchemaValue>>,
  Readonly<Record<string, JsonSchemaValue>>
> = z.record(z.string(), jsonSchemaInputValueSchema).readonly();

const jsonSchemaInputPluginOptionsSchemaValue: z.ZodType<
  JsonSchemaInputPluginOptionsOutput,
  JsonSchemaInputPluginOptionsInputValue
> = z
  .strictObject({
    dialect: withCLI(jsonSchemaDialectSchema.default("draft-2020-12"), {
      description: "JSON Schema dialect.",
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
export type JsonSchemaInputPluginOptionsInput = z.input<
  typeof jsonSchemaInputPluginOptionsSchemaValue
>;
