import assert from "node:assert/strict";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type {
  JsonObject,
  JsonSchemaDialect,
  JsonSchemaInputPluginOptions,
  JsonSchemaValue,
} from "../src";

export const expectOk = <TValue>(result: { ok: true; value: TValue } | { ok: false }): TValue => {
  assert.equal(result.ok, true);
  return result.value;
};

export const prepareSchema = async (
  schema: JsonSchemaValue,
  options: JsonSchemaInputPluginOptions,
  sourcePath = "custom.json",
): Promise<Awaited<ReturnType<typeof jsonSchemaInputPlugin.prepare>>> => {
  const prepared = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "file", path: sourcePath }, text: JSON.stringify(schema) },
    options,
  );
  return prepared;
};

const dialectDate = (dialect: Exclude<JsonSchemaDialect, "draft-7">): string =>
  dialect === "draft-2020-12" ? "2020-12" : "2019-09";

export const stockSchemaUri = (dialect: Exclude<JsonSchemaDialect, "draft-7">): string =>
  `https://json-schema.org/draft/${dialectDate(dialect)}/schema`;

const formatAssertionVocabularyUri = (dialect: Exclude<JsonSchemaDialect, "draft-7">): string =>
  dialect === "draft-2020-12"
    ? "https://json-schema.org/draft/2020-12/vocab/format-assertion"
    : "https://json-schema.org/draft/2019-09/vocab/format";

const vocabularyNames = [
  "applicator",
  "core",
  "formatAssertion",
  "unevaluated",
  "validation",
] as const;
type VocabularyName = (typeof vocabularyNames)[number];
type VocabularyDeclarations = Readonly<
  Partial<Record<VocabularyName, boolean>> & {
    additional?: Readonly<Record<string, boolean>> | undefined;
  }
>;

const declaredVocabularies = (
  dialect: Exclude<JsonSchemaDialect, "draft-7">,
  declarations: VocabularyDeclarations,
): Readonly<Record<string, boolean>> =>
  Object.fromEntries([
    ...vocabularyNames.flatMap((name) => {
      const required = declarations[name];
      const uri =
        name === "formatAssertion"
          ? formatAssertionVocabularyUri(dialect)
          : `https://json-schema.org/draft/${dialectDate(dialect)}/vocab/${name}`;
      return required === undefined ? [] : [[uri, required] as const];
    }),
    ...Object.entries(declarations.additional ?? {}),
  ]);

export const customMetaschema = (
  dialect: Exclude<JsonSchemaDialect, "draft-7">,
  uri: string,
  vocabularies: VocabularyDeclarations,
): JsonObject => ({
  $id: uri,
  $schema: stockSchemaUri(dialect),
  $vocabulary: declaredVocabularies(dialect, vocabularies),
  allOf: ["core", "applicator"].map((name) => ({
    $ref: `https://json-schema.org/draft/${dialectDate(dialect)}/meta/${name}`,
  })),
});

export const optionsFor = (
  dialect: Exclude<JsonSchemaDialect, "draft-7">,
  uri: string,
  vocabularies: VocabularyDeclarations,
): JsonSchemaInputPluginOptions =>
  jsonSchemaInputPluginOptionsSchema.parse({
    dialect,
    externalSchemas: { [uri]: customMetaschema(dialect, uri, vocabularies) },
    validator: "ajv",
  });
