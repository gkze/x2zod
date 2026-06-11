import { z } from "zod/v4";

import { jsonSchemaValueSchema } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaDialects, jsonSchemaSourceProfiles, jsonSchemaValidators } from "./metadata";
import type { JsonSchemaDialect, JsonSchemaSourceProfile, JsonSchemaValidator } from "./metadata";

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
    dialect: jsonSchemaDialectSchema.default("draft-2020-12"),
    externalSchemas: externalSchemasSchemaValue.default({}),
    sourceProfile: jsonSchemaSourceProfileSchema.default("none"),
    validator: jsonSchemaValidatorSchema.default("ajv"),
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
