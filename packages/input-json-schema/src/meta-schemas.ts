import draft2019Applicator from "ajv/dist/refs/json-schema-2019-09/meta/applicator.json";
import draft2019Content from "ajv/dist/refs/json-schema-2019-09/meta/content.json";
import draft2019Core from "ajv/dist/refs/json-schema-2019-09/meta/core.json";
import draft2019Format from "ajv/dist/refs/json-schema-2019-09/meta/format.json";
import draft2019Metadata from "ajv/dist/refs/json-schema-2019-09/meta/meta-data.json";
import draft2019Validation from "ajv/dist/refs/json-schema-2019-09/meta/validation.json";
import draft2019Schema from "ajv/dist/refs/json-schema-2019-09/schema.json";
import draft2020Applicator from "ajv/dist/refs/json-schema-2020-12/meta/applicator.json";
import draft2020Content from "ajv/dist/refs/json-schema-2020-12/meta/content.json";
import draft2020Core from "ajv/dist/refs/json-schema-2020-12/meta/core.json";
import draft2020Format from "ajv/dist/refs/json-schema-2020-12/meta/format-annotation.json";
import draft2020Metadata from "ajv/dist/refs/json-schema-2020-12/meta/meta-data.json";
import draft2020Unevaluated from "ajv/dist/refs/json-schema-2020-12/meta/unevaluated.json";
import draft2020Validation from "ajv/dist/refs/json-schema-2020-12/meta/validation.json";
import draft2020Schema from "ajv/dist/refs/json-schema-2020-12/schema.json";
import draft7Schema from "ajv/dist/refs/json-schema-draft-07.json";

import type { JsonObject, JsonSchemaValue } from "./document";
import type { JsonSchemaDialect } from "./options";
import { canonicalJsonSchemaAddress } from "./retrieval-uri";

type JsonSchemaResourceMap = Readonly<Record<string, JsonSchemaValue>>;
type JsonSchemaObjectMap = Readonly<Record<string, JsonObject>>;

const schemaUris = {
  "draft-7": [
    "http://json-schema.org/draft-07/schema",
    "http://json-schema.org/draft-07/schema#",
    "https://json-schema.org/draft-07/schema",
    "https://json-schema.org/draft-07/schema#",
  ],
  "draft-2019-09": [
    "https://json-schema.org/draft/2019-09/schema",
    "https://json-schema.org/draft/2019-09/schema#",
  ],
  "draft-2020-12": [
    "https://json-schema.org/draft/2020-12/schema",
    "https://json-schema.org/draft/2020-12/schema#",
  ],
} as const satisfies Readonly<Record<JsonSchemaDialect, readonly string[]>>;

const draft7Resources: JsonSchemaResourceMap = {
  "http://json-schema.org/draft-07/schema": draft7Schema,
};
const draft2019Resources: JsonSchemaResourceMap = {
  "https://json-schema.org/draft/2019-09/meta/applicator": draft2019Applicator,
  "https://json-schema.org/draft/2019-09/meta/content": draft2019Content,
  "https://json-schema.org/draft/2019-09/meta/core": draft2019Core,
  "https://json-schema.org/draft/2019-09/meta/format": draft2019Format,
  "https://json-schema.org/draft/2019-09/meta/meta-data": draft2019Metadata,
  "https://json-schema.org/draft/2019-09/meta/validation": draft2019Validation,
  "https://json-schema.org/draft/2019-09/schema": draft2019Schema,
};
const draft2020Resources: JsonSchemaResourceMap = {
  "https://json-schema.org/draft/2020-12/meta/applicator": draft2020Applicator,
  "https://json-schema.org/draft/2020-12/meta/content": draft2020Content,
  "https://json-schema.org/draft/2020-12/meta/core": draft2020Core,
  "https://json-schema.org/draft/2020-12/meta/format-annotation": draft2020Format,
  "https://json-schema.org/draft/2020-12/meta/meta-data": draft2020Metadata,
  "https://json-schema.org/draft/2020-12/meta/unevaluated": draft2020Unevaluated,
  "https://json-schema.org/draft/2020-12/meta/validation": draft2020Validation,
  "https://json-schema.org/draft/2020-12/schema": draft2020Schema,
};
const rootSchemas = {
  "draft-7": draft7Schema,
  "draft-2019-09": draft2019Schema,
  "draft-2020-12": draft2020Schema,
} as const satisfies Readonly<Record<JsonSchemaDialect, JsonObject>>;
const supportedDialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;

export const jsonSchemaDialectMetaSchemas = (dialect: JsonSchemaDialect): JsonSchemaResourceMap => {
  if (dialect === "draft-7") return draft7Resources;
  if (dialect === "draft-2019-09") return draft2019Resources;
  return draft2020Resources;
};

export const jsonSchemaDialectForSchemaUri = (uri: string): JsonSchemaDialect | undefined => {
  const canonicalUri = canonicalJsonSchemaAddress(uri);
  if (
    schemaUris["draft-7"].some(
      (candidate) => canonicalJsonSchemaAddress(candidate) === canonicalUri,
    )
  )
    return "draft-7";
  if (
    schemaUris["draft-2019-09"].some(
      (candidate) => canonicalJsonSchemaAddress(candidate) === canonicalUri,
    )
  )
    return "draft-2019-09";
  if (
    schemaUris["draft-2020-12"].some(
      (candidate) => canonicalJsonSchemaAddress(candidate) === canonicalUri,
    )
  )
    return "draft-2020-12";
  return undefined;
};

export const jsonSchemaDialectMetaSchemaAliases = (
  dialect: JsonSchemaDialect,
): JsonSchemaObjectMap => {
  const resources = jsonSchemaDialectMetaSchemas(dialect);
  return Object.fromEntries(
    [...new Set(schemaUris[dialect].map((uri) => uri.replace(/#$/u, "")))]
      .filter((uri) => !Object.hasOwn(resources, uri))
      .map((uri) => [uri, { ...rootSchemas[dialect], $id: uri }]),
  );
};

const supportedMetaSchemas: Record<string, JsonSchemaValue> = {};
for (const dialect of supportedDialects)
  Object.assign(
    supportedMetaSchemas,
    jsonSchemaDialectMetaSchemas(dialect),
    jsonSchemaDialectMetaSchemaAliases(dialect),
  );

export const supportedJsonSchemaMetaSchemas = (): JsonSchemaResourceMap => supportedMetaSchemas;

export const isSupportedJsonSchemaMetaSchemaResource = (resourceUri: string): boolean =>
  Object.hasOwn(supportedMetaSchemas, canonicalJsonSchemaAddress(resourceUri));
