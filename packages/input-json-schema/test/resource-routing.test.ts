import assert from "node:assert/strict";
import { test } from "node:test";

import type { Result, ZodEmissionModuleInput } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonObject, JsonSchemaDialect, JsonSchemaInputPluginOptions } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const stockSchemaUri = (dialect: JsonSchemaDialect): string =>
  `https://json-schema.org/draft/${dialect === "draft-2020-12" ? "2020-12" : "2019-09"}/schema`;

const options = (
  input: Partial<JsonSchemaInputPluginOptions> &
    Readonly<{ externalSchemas?: JsonSchemaInputPluginOptions["externalSchemas"] }> = {},
): JsonSchemaInputPluginOptions => jsonSchemaInputPluginOptionsSchema.parse(input);

const customMeta = (uri: string, dialect: Exclude<JsonSchemaDialect, "draft-7">): JsonObject => ({
  $id: uri,
  $schema: stockSchemaUri(dialect),
  $vocabulary: {
    [`https://json-schema.org/draft/${dialect === "draft-2020-12" ? "2020-12" : "2019-09"}/vocab/applicator`]: true,
    [`https://json-schema.org/draft/${dialect === "draft-2020-12" ? "2020-12" : "2019-09"}/vocab/core`]: true,
  },
});

const lowerInline = async (
  schema: object,
  pluginOptions: JsonSchemaInputPluginOptions,
): Promise<Result<ZodEmissionModuleInput>> => {
  const prepared = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "file", path: "routing.json" }, text: JSON.stringify(schema) },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);
  return jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
};

void test("preflight ignores unused invalid externals but validates referenced ones", async () => {
  const unused = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "file", path: "unused.json" }, text: '{ "type": "number" }' },
    options({ externalSchemas: { "https://example.test/unused.json": { type: "nonsense" } } }),
  );
  assert.equal(unused.ok, true);

  const referenced = await jsonSchemaInputPlugin.prepare(
    {
      source: { kind: "file", path: "referenced.json" },
      text: '{ "$ref": "https://example.test/referenced.json" }',
    },
    options({ externalSchemas: { "https://example.test/referenced.json": { type: "nonsense" } } }),
  );
  assert.equal(referenced.ok, false);
  assert.ok(referenced.diagnostics.some(({ code }) => code === "invalid_schema_document"));

  const literal = await jsonSchemaInputPlugin.prepare(
    {
      source: { kind: "file", path: "literal.json" },
      text: JSON.stringify({ const: { $ref: "https://example.test/literal-invalid.json" } }),
    },
    options({
      externalSchemas: { "https://example.test/literal-invalid.json": { type: "nonsense" } },
    }),
  );
  assert.equal(literal.ok, true);

  const unrelatedDraft = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "file", path: "unrelated-draft.json" }, text: '{ "type": "number" }' },
    options({
      externalSchemas: {
        "https://example.test/unrelated-draft.json": {
          $schema: "https://json-schema.org/draft/2019-09/schema",
          type: "nonsense",
        },
      },
    }),
  );
  assert.equal(unrelatedDraft.ok, true);
});

void test("keeps the inline root identity disjoint from external registry keys", async () => {
  const syntheticUri = "x2zod://root/";
  const pluginOptions = options({
    externalSchemas: { [syntheticUri]: { type: "number" } },
    validator: "none",
  });
  const unused = await jsonSchemaInputPlugin.prepare(
    { source: { id: "synthetic-unused", kind: "inline" }, text: '{ "type": "string" }' },
    pluginOptions,
  );
  assert.equal(unused.ok, true);

  const selected = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "synthetic-selected", kind: "inline" },
      text: JSON.stringify({ $ref: syntheticUri }),
    },
    pluginOptions,
  );
  assert.equal(selected.ok, true);
  const lowered = await jsonSchemaInputPlugin.lower(selected.value, pluginOptions);
  assert.equal(lowered.ok, true);
  const expression = lowered.value.declarations[0]?.expression;
  if (expression?.kind !== "factory") throw new Error("Expected a factory expression.");
  assert.equal(expression.factory, "number");
});

void test("does not let an exact external key replace a built-in metaschema", async () => {
  const schemaUri = stockSchemaUri("draft-2020-12");
  const pluginOptions = options({ externalSchemas: { [schemaUri]: false }, validator: "none" });
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "reserved-metaschema-key", kind: "inline" },
      text: JSON.stringify({ $ref: schemaUri, $schema: schemaUri }),
    },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, false);
  assert.match(lowered.diagnostics[0].message, /reserved for a built-in meta-schema/u);
});

void test("preflight does not raw-match a local reference to an external identifier", async () => {
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "local-reference", kind: "inline" },
      text: JSON.stringify({ $defs: { value: { type: "string" } }, $ref: "#/$defs/value" }),
    },
    options({
      externalSchemas: {
        "https://example.test/unused.json": { $id: "#/$defs/value", type: "number" },
      },
    }),
  );

  assert.equal(result.ok, true);
});

void test("keeps external content schemas annotation-only by default", async () => {
  const resourceUri = "https://example.test/resource/content-annotation";
  const result = await lowerInline(
    { $ref: resourceUri },
    options({
      externalSchemas: {
        [resourceUri]: {
          contentMediaType: "application/json",
          contentSchema: { x2zodUnknown: true },
          type: "string",
        },
      },
    }),
  );

  assert.equal(result.ok, true);
});

void test("reports reachable external profile metadata once", async () => {
  const resourceUri = "https://example.test/resource/opencode-metadata";
  const result = await lowerInline(
    { $ref: resourceUri },
    options({
      externalSchemas: { [resourceUri]: { allowComments: true, type: "string" } },
      sourceProfile: "opencode",
      validator: "none",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.diagnostics?.filter(({ code }) => code === "json-schema/ignored-keyword").length ?? 0,
    1,
  );
});

void test("diagnoses schema-valued unevaluatedItems", async () => {
  const pluginOptions = options({ validator: "none" });
  const result = await lowerInline(
    { type: "array", unevaluatedItems: { x2zodUnknown: true } },
    pluginOptions,
  );
  assert.equal(
    result.diagnostics?.some(
      ({ code, location }) =>
        code === "unknown_keyword" && location?.pointer === "/unevaluatedItems/x2zodUnknown",
    ) ?? false,
    true,
  );
});

void test("ignores unrelated required vocabularies", async () => {
  const metaUri = "https://example.test/meta/unrelated";
  const resourceUri = "https://example.test/resource/unrelated";
  const pluginOptions = options({
    externalSchemas: {
      [metaUri]: {
        ...customMeta(metaUri, "draft-2020-12"),
        $vocabulary: { "https://example.test/vocab/unknown": true },
      },
      [resourceUri]: { $id: resourceUri, $schema: metaUri, type: "string" },
    },
    validator: "none",
  });
  const result = await lowerInline({ type: "string" }, pluginOptions);
  assert.equal(result.ok, true);
});

void test("preflights a reachable resource under its declared stock dialect", async () => {
  const resourceUri = "https://example.test/resource/draft-7";
  const pluginOptions = options({
    externalSchemas: {
      [resourceUri]: {
        $id: resourceUri,
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalItems: false,
        items: [{ type: "string" }],
        type: "array",
      },
    },
  });
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { kind: "file", path: "cross-dialect.json" },
      text: JSON.stringify({ $ref: resourceUri, $schema: stockSchemaUri("draft-2020-12") }),
    },
    pluginOptions,
  );

  assert.equal(prepared.ok, true);
});

void test("strips validation from legacy tuple items under an omitted vocabulary", async () => {
  const metaUri = "https://example.test/meta/no-validation-tuple";
  const pluginOptions = options({
    dialect: "draft-2019-09",
    externalSchemas: { [metaUri]: customMeta(metaUri, "draft-2019-09") },
    validator: "none",
  });
  const result = await lowerInline(
    { $schema: metaUri, items: [{ minimum: 10, type: "number" }], type: "array" },
    pluginOptions,
  );
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result.value.declarations[0]?.expression), /gte/u);
});

void test("preserves validation re-enabled by an embedded custom dialect", async () => {
  const parentMetaUri = "urn:example:no-validation-meta";
  const nestedMetaUri = "urn:example:validation-meta";
  const modelUri = "urn:example:validation-model";
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $defs: {
        meta: {
          $id: nestedMetaUri,
          $schema: stockSchemaUri("draft-2020-12"),
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/applicator": true,
            "https://json-schema.org/draft/2020-12/vocab/core": true,
            "https://json-schema.org/draft/2020-12/vocab/validation": true,
          },
        },
        model: {
          $id: modelUri,
          $schema: nestedMetaUri,
          propertyNames: { pattern: "^x" },
          type: "object",
        },
      },
      $ref: modelUri,
      $schema: parentMetaUri,
    },
    {
      externalSchema: customMeta(parentMetaUri, "draft-2020-12"),
      externalSchemaUri: parentMetaUri,
    },
  );

  assert.equal(generatedSchema.safeParse({ xok: 1 }).success, true);
  assert.equal(generatedSchema.safeParse({ bad: 1 }).success, false);
  assert.equal(generatedSchema.safeParse(null).success, false);
});

void test("projects validation policy onto pointer targets in arbitrary data", async () => {
  const metaUri = "https://example.test/meta/no-validation-examples";
  const pluginOptions = options({
    dialect: "draft-2020-12",
    externalSchemas: { [metaUri]: customMeta(metaUri, "draft-2020-12") },
    validator: "none",
  });
  const result = await lowerInline(
    {
      $schema: metaUri,
      $ref: "#/examples/0",
      examples: [
        { minProperties: 2, patternProperties: { "^x": { type: "string" } }, type: "object" },
      ],
    },
    pluginOptions,
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.runtimePrograms?.length, 1);
});

void test("keeps a materialized local pointer bound despite an unused duplicate identifier", async () => {
  const rootUri = "https://example.test/root";
  const { generatedSchema } = await compileGeneratedSchema(
    { $id: rootUri, $ref: "#/examples/0", examples: [{ type: "string" }] },
    {
      externalSchema: { $id: rootUri, type: "number" },
      externalSchemaUri: "https://registry.example/z.json",
    },
  );

  assert.equal(generatedSchema.safeParse("accepted").success, true);
  assert.equal(generatedSchema.safeParse(1).success, false);
});

void test("diagnoses unknown keywords reached through dynamic and recursive references", async () => {
  const dynamicUri = "https://example.test/resource/dynamic";
  const dynamicResult = await lowerInline(
    { $dynamicRef: `${dynamicUri}#target` },
    options({
      externalSchemas: { [dynamicUri]: { $dynamicAnchor: "target", x2zodUnknown: true } },
      validator: "none",
    }),
  );
  assert.equal(dynamicResult.ok, false);
  assert.ok(dynamicResult.diagnostics.some(({ code }) => code === "unknown_keyword"));

  const recursiveUri = "https://example.test/resource/recursive";
  const recursiveResult = await lowerInline(
    { $ref: recursiveUri },
    options({
      dialect: "draft-2019-09",
      externalSchemas: {
        [recursiveUri]: {
          $recursiveAnchor: true,
          properties: { child: { $recursiveRef: "#" } },
          x2zodUnknown: true,
        },
      },
      validator: "none",
    }),
  );
  assert.equal(recursiveResult.ok, false);
  assert.ok(recursiveResult.diagnostics.some(({ code }) => code === "unknown_keyword"));
});

void test("quarantines malformed URI identifiers until their resource is reachable", async () => {
  const unusedUri = "https://example.test/resource/malformed-unused";
  const unusedResult = await lowerInline(
    { type: "string" },
    options({
      externalSchemas: { [unusedUri]: { $id: "#%ZZ", type: "number" } },
      validator: "none",
    }),
  );
  assert.equal(unusedResult.ok, true);

  const referencedUri = "https://example.test/resource/malformed-referenced";
  const referencedResult = await lowerInline(
    { $ref: referencedUri },
    options({
      externalSchemas: { [referencedUri]: { $id: "#%ZZ", type: "number" } },
      validator: "none",
    }),
  );
  assert.equal(referencedResult.ok, false);
  assert.ok(referencedResult.diagnostics.some(({ code }) => code === "invalid_schema_document"));
});

void test("applies external resource policy to pointer targets", async () => {
  const metaUri = "https://example.test/meta/no-validation";
  const resourceUri = "https://example.test/resource/target";
  const pluginOptions = options({
    dialect: "draft-2020-12",
    externalSchemas: {
      [metaUri]: customMeta(metaUri, "draft-2020-12"),
      [resourceUri]: {
        $id: resourceUri,
        $schema: metaUri,
        $defs: { target: { minimum: 10, type: "number" } },
      },
    },
    validator: "none",
  });
  const lowered = await lowerInline({ $ref: `${resourceUri}#/$defs/target` }, pluginOptions);
  assert.equal(lowered.ok, true);
  const target = lowered.value.declarations.find(
    (declaration) => declaration.symbol === `schema:${resourceUri}#/$defs/target`,
  );
  assert.ok(target);
  assert.doesNotMatch(JSON.stringify(target.expression), /gte/u);
});

void test("inherits an external container policy for direct and indirect refs", async () => {
  const metaUri = "https://example.test/meta/root-no-validation";
  const containerUri = "https://example.test/resource/container";
  const externalSchemas = {
    [metaUri]: customMeta(metaUri, "draft-2020-12"),
    [containerUri]: {
      $id: containerUri,
      $schema: stockSchemaUri("draft-2020-12"),
      $ref: "#/$defs/target",
      $defs: { target: { minProperties: 2, type: "object" } },
    },
  };
  const direct = await lowerInline(
    { $ref: `${containerUri}#/$defs/target`, $schema: metaUri },
    options({ externalSchemas, validator: "none" }),
  );
  const indirect = await lowerInline(
    { $ref: containerUri, $schema: metaUri },
    options({ externalSchemas, validator: "none" }),
  );

  assert.equal(direct.ok, true);
  assert.equal(indirect.ok, true);
  assert.equal(direct.value.runtimePrograms?.length, 1);
  assert.equal(indirect.value.runtimePrograms?.length, 1);
});

void test("normalizes trailing registry fragments for custom metaschemas", async () => {
  const metaUri = "https://example.test/meta/trailing-hash";
  const containerUri = "https://example.test/resource/trailing-hash";
  const schema = { $ref: `${containerUri}#/$defs/target`, $schema: metaUri };
  const bare = await lowerInline(
    schema,
    options({
      externalSchemas: {
        [metaUri]: customMeta(metaUri, "draft-2020-12"),
        [containerUri]: {
          $id: containerUri,
          $schema: stockSchemaUri("draft-2020-12"),
          $defs: { target: { minProperties: 2, type: "object" } },
        },
      },
      validator: "none",
    }),
  );
  const trailing = await lowerInline(
    schema,
    options({
      externalSchemas: {
        [`${metaUri}#`]: customMeta(metaUri, "draft-2020-12"),
        [`${containerUri}#`]: {
          $id: containerUri,
          $schema: stockSchemaUri("draft-2020-12"),
          $defs: { target: { minProperties: 2, type: "object" } },
        },
      },
      validator: "none",
    }),
  );

  assert.equal(bare.ok, true);
  assert.equal(trailing.ok, true);
  assert.equal(bare.value.runtimePrograms?.length, trailing.value.runtimePrograms?.length);
});

void test("applies a dialect switch in an enclosing external resource", async () => {
  const containerUri = "https://example.test/resource/draft7-container";
  const result = await lowerInline(
    { $ref: `${containerUri}#/definitions/target` },
    options({
      externalSchemas: {
        [containerUri]: {
          $id: containerUri,
          $schema: "http://json-schema.org/draft-07/schema#",
          definitions: { target: { type: "string" } },
        },
      },
      validator: "none",
    }),
  );

  assert.equal(result.ok, true);
});
