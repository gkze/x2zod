import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../src";
import { buildJsonSchemaResourceGraph } from "../src/resource-graph";

const rootRetrievalUri = "https://retrieval.example.test/root.json";
const draft2020SchemaUri = "https://json-schema.org/draft/2020-12/schema";

const buildGraph = (
  schema: JsonSchemaValue,
  dialect: JsonSchemaDialect = "draft-2020-12",
  externalSchemas: Readonly<Record<string, JsonSchemaValue>> = {},
): ReturnType<typeof buildJsonSchemaResourceGraph> =>
  buildJsonSchemaResourceGraph({ dialect, externalSchemas, rootRetrievalUri, schema });

void test("rejects malformed ref URI-references in every dialect", () => {
  for (const dialect of ["draft-7", "draft-2019-09", "draft-2020-12"] as const) {
    const result = buildGraph({ $ref: "%ZZ" }, dialect);
    const wrongType = buildGraph({ $ref: 1 }, dialect);
    assert.equal(result.ok, false, dialect);
    assert.equal(result.diagnostics[0].location?.pointer, "/$ref", dialect);
    assert.equal(wrongType.ok, false, `${dialect} wrong type`);
  }
});

void test("validates dialect-specific dynamic and recursive reference boundaries", () => {
  const dynamic = buildGraph({ $dynamicRef: "%ZZ" }, "draft-2020-12");
  const recursive = buildGraph({ $recursiveRef: "%ZZ" }, "draft-2019-09");
  const dynamicWrongType = buildGraph({ $dynamicRef: 1 }, "draft-2020-12");
  const recursiveWrongType = buildGraph({ $recursiveRef: 1 }, "draft-2019-09");

  assert.equal(dynamic.ok, false);
  assert.equal(recursive.ok, false);
  assert.equal(dynamicWrongType.ok, false);
  assert.equal(recursiveWrongType.ok, false);
});

void test("enforces Draft 2019-09 recursive keyword shapes without a validator", async () => {
  const schemas = [
    { $recursiveRef: "#/$defs/target", $defs: { target: { type: "string" } } },
    { $recursiveRef: "https://example.test/target" },
    { $recursiveAnchor: "true", type: "object" },
  ] as const;
  const results = await Promise.all(
    schemas.map(async (schema) => {
      const result = await compileToZodSource({
        document: {
          source: { id: "invalid-recursive-keyword", kind: "inline" },
          text: JSON.stringify(schema),
        },
        output: { typeName: "InvalidRecursiveKeyword" },
        plugin: jsonSchemaInputPlugin,
        pluginOptions: { dialect: "draft-2019-09", validator: "none" },
      });
      return result;
    }),
  );

  for (const [index, result] of results.entries()) {
    const schema = schemas[index];
    assert.equal(result.ok, false, JSON.stringify(schema));
    assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  }
});

void test("rejects non-string identifiers without a validator in every dialect", async () => {
  const dialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;
  const results = await Promise.all(
    dialects.map(async (dialect) => {
      const result = await compileToZodSource({
        document: {
          source: { id: `non-string-id-${dialect}`, kind: "inline" },
          text: JSON.stringify({ $id: 42, type: "string" }),
        },
        output: { typeName: "NonStringIdentifier" },
        plugin: jsonSchemaInputPlugin,
        pluginOptions: { dialect, validator: "none" },
      });
      return result;
    }),
  );

  for (const [index, result] of results.entries()) {
    const dialect = dialects[index];
    assert.equal(result.ok, false, dialect);
    assert.equal(result.diagnostics[0].code, "invalid_schema_document", dialect);
    assert.equal(result.diagnostics[0].location?.pointer, "/$id", dialect);
  }

  assert.equal(buildGraph({ $id: 42, $ref: "#" }, "draft-7").ok, true);
});

void test("validates every reference in a selected external document", () => {
  const externalUri = "https://registry.example.test/selected.json";
  const result = buildGraph({ $ref: externalUri }, "draft-2020-12", {
    [externalUri]: { $defs: { invalid: { $ref: "%ZZ" } } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].location?.pointer, "/$defs/invalid/$ref");
});

void test("requires schema declarations to be absolute URIs with valid types", () => {
  for (const schema of [
    { $schema: "relative" },
    { $schema: "https://example.test/%ZZ" },
    { $schema: 1 },
  ] as const) {
    const result = buildGraph(schema);
    assert.equal(result.ok, false, JSON.stringify(schema));
  }

  assert.equal(buildGraph({ $schema: `${draft2020SchemaUri}#` }).ok, true);
  assert.equal(buildGraph({ $schema: "https://example.test/meta#custom" }).ok, true);
});

void test("resolves a normalized fragment-addressed custom metaschema", async () => {
  const metaUri = "https://example.test/meta";
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "fragment-custom-meta", kind: "inline" },
      text: JSON.stringify({ $schema: `${metaUri}#custom`, type: "string" }),
    },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [metaUri]: {
          $anchor: "custom",
          $id: metaUri,
          $schema: draft2020SchemaUri,
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/applicator": true,
            "https://json-schema.org/draft/2020-12/vocab/core": true,
            "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
            "https://json-schema.org/draft/2020-12/vocab/validation": true,
          },
        },
      },
      validator: "ajv",
    }),
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.value.dialect, "draft-2020-12");
});

void test("requires schema declarations and vocabulary names to be normalized", () => {
  const schemaDeclaration = buildGraph({ $schema: "HTTPS://JSON-SCHEMA.ORG/draft/2020-12/schema" });
  const vocabularyDeclaration = buildGraph({
    $vocabulary: { "HTTPS://EXAMPLE.TEST/a/../%7Evocab": true },
  });

  assert.equal(schemaDeclaration.ok, false);
  assert.equal(schemaDeclaration.diagnostics[0].location?.pointer, "/$schema");
  assert.equal(vocabularyDeclaration.ok, false);
  assert.equal(
    vocabularyDeclaration.diagnostics[0].location?.pointer,
    "/$vocabulary/HTTPS:~1~1EXAMPLE.TEST~1a~1..~1%7Evocab",
  );
});

void test("allows schema declarations only at schema-resource roots", () => {
  const misplaced = buildGraph({ $defs: { nested: { $schema: draft2020SchemaUri } } });
  const resourceRoot = buildGraph({
    $defs: { nested: { $id: "child", $schema: draft2020SchemaUri } },
  });
  const duplicateEmptyIdentifier = buildGraph({
    $defs: { nested: { $id: "#", $schema: draft2020SchemaUri } },
  });

  assert.equal(misplaced.ok, false);
  assert.equal(misplaced.diagnostics[0].location?.pointer, "/$defs/nested/$schema");
  assert.equal(resourceRoot.ok, true);
  assert.equal(duplicateEmptyIdentifier.ok, false);
});

void test("validates vocabulary names, values, and resource-root placement", () => {
  for (const vocabulary of [
    { relative: true },
    { "https://example.test/%ZZ": true },
    { "https://example.test/vocab#": true },
    { "https://example.test/vocab": "required" },
  ] as const) {
    const result = buildGraph({ $vocabulary: vocabulary });
    assert.equal(result.ok, false, JSON.stringify(vocabulary));
  }
  assert.equal(buildGraph({ $vocabulary: true }).ok, false);
  assert.equal(buildGraph({ $vocabulary: { "https://example.test/vocab#custom": true } }).ok, true);

  const misplaced = buildGraph({
    $defs: { nested: { $vocabulary: { "https://example.test/vocab": true } } },
  });
  const resourceRoot = buildGraph({
    $defs: { nested: { $id: "child", $vocabulary: { "https://example.test/vocab": true } } },
  });
  assert.equal(misplaced.ok, false);
  assert.equal(misplaced.diagnostics[0].location?.pointer, "/$defs/nested/$vocabulary");
  assert.equal(resourceRoot.ok, true);
});

void test("rejects invalid applicable anchor names even without preflight", async () => {
  const cases = ["1node", "a/b", "a:b", 1].flatMap((name) =>
    (
      [
        ["draft-2019-09", "$anchor"],
        ["draft-2020-12", "$anchor"],
        ["draft-2020-12", "$dynamicAnchor"],
      ] as const
    ).map(([dialect, keyword]) => ({ dialect, keyword, name })),
  );
  for (const { dialect, keyword, name } of cases) {
    const graph = buildGraph({ [keyword]: name }, dialect);
    assert.equal(graph.ok, false, `${dialect} ${keyword} ${name}`);
    assert.equal(graph.diagnostics[0].location?.pointer, `/${keyword}`);
  }
  const compiled = await Promise.all(
    cases.map(async ({ dialect, keyword, name }) => {
      const result = await compileToZodSource({
        document: {
          source: { id: `invalid-${keyword}-${name}`, kind: "inline" },
          text: JSON.stringify({ [keyword]: name }),
        },
        output: { typeName: "InvalidAnchor" },
        plugin: jsonSchemaInputPlugin,
        pluginOptions: { dialect, validator: "none" },
      });
      return { dialect, keyword, name, result };
    }),
  );
  for (const { dialect, keyword, name, result } of compiled) {
    assert.equal(result.ok, false, `${dialect} ${keyword} ${name} compiler`);
    assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  }
});

void test("quarantines URI-boundary failures in wholly unused external documents", () => {
  const result = buildGraph(true, "draft-2020-12", {
    "https://registry.example.test/unused.json": {
      $defs: { invalid: { $ref: "%ZZ", $schema: "relative" } },
      $vocabulary: { relative: true },
    },
  });

  assert.equal(result.ok, true);
});

void test("ignores reference keywords that do not apply to the effective dialect", () => {
  const externalUri = "https://registry.example.test/invalid-identifier.json";
  const cases = [
    ["draft-7", "$dynamicRef"],
    ["draft-7", "$recursiveRef"],
    ["draft-2019-09", "$dynamicRef"],
    ["draft-2020-12", "$recursiveRef"],
  ] as const;

  for (const [dialect, keyword] of cases) {
    const result = buildGraph({ [keyword]: externalUri }, dialect, {
      [externalUri]: { $id: "%ZZ" },
    });
    assert.equal(result.ok, true, `${dialect} ${keyword}`);

    const arbitraryPointer = buildGraph(
      { [keyword]: "#/examples/0", examples: [{ $id: "%ZZ" }] },
      dialect,
    );
    assert.equal(arbitraryPointer.ok, true, `${dialect} ${keyword} arbitrary pointer`);
  }
});

void test("follows only reference keywords that apply to the effective dialect", () => {
  const externalUri = "https://registry.example.test/invalid-identifier.json";
  const cases = [
    ["draft-7", "$ref"],
    ["draft-2019-09", "$ref"],
    ["draft-2019-09", "$recursiveRef"],
    ["draft-2020-12", "$ref"],
    ["draft-2020-12", "$dynamicRef"],
  ] as const;

  for (const [dialect, keyword] of cases) {
    const result = buildGraph({ [keyword]: externalUri }, dialect, {
      [externalUri]: { $id: "%ZZ" },
    });
    assert.equal(result.ok, false, `${dialect} ${keyword}`);
  }
});

void test("does not lower a Draft 2019-09 dynamic anchor as a named anchor", async () => {
  const result = await compileToZodSource({
    document: {
      source: { id: "draft-2019-dynamic-anchor", kind: "inline" },
      text: JSON.stringify({
        $defs: { target: { $dynamicAnchor: "named", type: "string" } },
        $ref: "#named",
      }),
    },
    output: { typeName: "Draft2019DynamicAnchor" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { dialect: "draft-2019-09", validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "unresolved_reference");
});

void test("protects lowering with validator none from malformed URI references", async () => {
  const result = await compileToZodSource({
    document: {
      source: { id: "malformed-reference", kind: "inline" },
      text: JSON.stringify({ $ref: "%ZZ" }),
    },
    output: { typeName: "MalformedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
});
