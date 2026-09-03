import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";
import { jsonSchemaKeywordPolicyForDialect } from "../src/metadata";
import { customMetaschema } from "./vocabulary-test-support";

const dialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;

const prepare = async (
  schema: JsonSchemaValue,
  options: JsonSchemaInputPluginOptionsInput = {},
): Promise<Awaited<ReturnType<typeof jsonSchemaInputPlugin.prepare>>> => {
  const result = await jsonSchemaInputPlugin.prepare(
    { source: { id: "dialect-policy", kind: "inline" }, text: JSON.stringify(schema) },
    jsonSchemaInputPluginOptionsSchema.parse(options),
  );
  return result;
};

void test("applies JSON Schema keyword availability by dialect", () => {
  for (const keyword of ["minContains", "maxContains"])
    assert.deepEqual(
      dialects.map((dialect) => jsonSchemaKeywordPolicyForDialect(keyword, dialect)),
      ["unknown", "supported", "supported"],
    );

  assert.deepEqual(
    dialects.map((dialect) => jsonSchemaKeywordPolicyForDialect("$defs", dialect)),
    ["unknown", "supported", "supported"],
  );
  assert.deepEqual(
    dialects.map((dialect) => jsonSchemaKeywordPolicyForDialect("definitions", dialect)),
    ["supported", "unknown", "unknown"],
  );
  assert.deepEqual(
    dialects.map((dialect) => jsonSchemaKeywordPolicyForDialect("unevaluatedItems", dialect)),
    ["unknown", "supported", "supported"],
  );
});

void test("keeps additionalItems as a pre-2020 keyword", () => {
  assert.deepEqual(
    dialects.map((dialect) => jsonSchemaKeywordPolicyForDialect("additionalItems", dialect)),
    ["supported", "supported", "unknown"],
  );
});

void test("rejects an explicit dialect that conflicts with the declaration", async () => {
  const result = await prepare(
    { $schema: "http://json-schema.org/draft-07/schema#", type: "string" },
    { dialect: "draft-2020-12", validator: "none" },
  );

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "dialect_conflict"));
});

void test("uses a declared dialect when the option is omitted", async () => {
  const result = await prepare({
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalItems: false,
    items: [{ type: "string" }],
    type: "array",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.value.dialect, "draft-7");
});

void test("defaults to Draft 2020-12 when option and declaration are omitted", async () => {
  const result = await prepare({ prefixItems: [{ type: "string" }], type: "array" });

  assert.equal(result.ok, true);
  assert.equal(result.value.value.dialect, "draft-2020-12");
});

void test("preflights every recognized Draft 7 schema URI alias", async () => {
  const schemaUris = [
    "http://json-schema.org/draft-07/schema",
    "http://json-schema.org/draft-07/schema#",
    "https://json-schema.org/draft-07/schema",
    "https://json-schema.org/draft-07/schema#",
  ];
  const results = await Promise.all(
    schemaUris.map(async (schemaUri) => {
      const result = await prepare({ $schema: schemaUri, type: "string" });
      return result;
    }),
  );

  for (const [index, result] of results.entries()) assert.equal(result.ok, true, schemaUris[index]);
});

void test("lowers a reference to the recognized Draft 7 HTTPS metaschema alias", async () => {
  const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({});
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "draft-7-https-reference", kind: "inline" },
      text: JSON.stringify({
        $ref: "https://json-schema.org/draft-07/schema#",
        $schema: "https://json-schema.org/draft-07/schema#",
      }),
    },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, true);
  assert.equal(
    lowered.value.declarations.some(({ symbol }) => symbol.includes("json-schema.org")),
    false,
  );
});

void test("resolves stock metaschemas required by a reachable embedded dialect", async () => {
  const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({});
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "mixed-dialect-metaschema-reference", kind: "inline" },
      text: JSON.stringify({
        $defs: {
          legacy: {
            $id: "legacy",
            allOf: [{ $ref: "https://json-schema.org/draft-07/schema#" }],
            $schema: "https://json-schema.org/draft-07/schema#",
          },
        },
        $ref: "legacy",
        $schema: "https://json-schema.org/draft/2020-12/schema",
      }),
    },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, true);
});

void test("does not inject a built-in over a root using the same retrieval URI", async () => {
  const uri = "https://json-schema.org/draft/2020-12/schema";
  const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({ validator: "none" });
  const prepared = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "uri", uri }, text: JSON.stringify({ $ref: uri, $schema: uri }) },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, true);
});

void test("compiles a root that owns its stock metaschema retrieval URI", async () => {
  const requests = [
    ["draft-7", "http://json-schema.org/draft-07/schema"],
    ["draft-2019-09", "https://json-schema.org/draft/2019-09/schema"],
    ["draft-2020-12", "https://json-schema.org/draft/2020-12/schema"],
  ] as const;
  const results = await Promise.all(
    requests.map(async ([dialect, uri]) => {
      const result = await compileToZodSource({
        document: {
          source: { kind: "uri", uri },
          text: JSON.stringify({ $id: uri, $schema: uri, type: "string" }),
        },
        output: { typeName: "OwnedMetaSchemaUri" },
        plugin: jsonSchemaInputPlugin,
        pluginOptions: { dialect, validator: "none" },
      });
      return result;
    }),
  );
  for (const result of results)
    assert.equal(result.ok, true, result.ok ? undefined : result.diagnostics[0].message);
});

void test("rejects a selected resource that claims a built-in metaschema identifier", async () => {
  const schemaUri = "https://json-schema.org/draft/2020-12/schema";
  const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({ validator: "none" });
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { kind: "uri", uri: "https://example.test/model" },
      text: JSON.stringify({ $id: schemaUri, $schema: schemaUri, type: "string" }),
    },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, false);
  assert.match(lowered.diagnostics[0].message, /conflicts with a built-in meta-schema/u);
});

void test("rejects a selected custom metaschema that claims a built-in identifier", async () => {
  const schemaUri = "https://json-schema.org/draft/2020-12/schema";
  const metaRetrievalUri = "https://example.test/meta/stock-id-collision";
  const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [metaRetrievalUri]: {
        $id: schemaUri,
        $schema: schemaUri,
        $vocabulary: {
          "https://json-schema.org/draft/2020-12/vocab/applicator": true,
          "https://json-schema.org/draft/2020-12/vocab/core": true,
          "https://json-schema.org/draft/2020-12/vocab/validation": true,
        },
      },
    },
    validator: "none",
  });
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "selected-custom-meta-stock-id", kind: "inline" },
      text: JSON.stringify({ $schema: metaRetrievalUri, type: "string" }),
    },
    pluginOptions,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  assert.equal(lowered.ok, false);
  assert.match(lowered.diagnostics[0].message, /conflicts with a built-in meta-schema/u);
});

void test("does not validate an unreachable embedded resource under its parent dialect", async () => {
  const result = await prepare({
    $defs: {
      legacy: {
        $id: "legacy",
        $schema: "http://json-schema.org/draft-07/schema#",
        items: [{ type: "string" }],
        type: "array",
      },
    },
    type: "string",
  });

  assert.equal(result.ok, true);
});

void test("preflights an unreachable embedded resource under its own dialect", async () => {
  const result = await prepare({
    $schema: "http://json-schema.org/draft-07/schema#",
    definitions: {
      modern: {
        $id: "modern",
        $schema: "https://json-schema.org/draft/2020-12/schema",
        prefixItems: ["not-a-schema"],
      },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "invalid_schema_document"));
});

void test("loads a custom metaschema for an unreachable embedded resource", async () => {
  const metaUri = "https://example.test/meta/embedded";
  const result = await prepare(
    { $defs: { embedded: { $id: "embedded", $schema: metaUri, type: "string" } }, type: "string" },
    {
      externalSchemas: {
        [metaUri]: customMetaschema("draft-2020-12", metaUri, {
          applicator: true,
          core: true,
          validation: true,
        }),
      },
    },
  );

  assert.equal(result.ok, true);
});

void test("loads external references required by a custom metaschema", async () => {
  const dependencyUri = "https://example.test/meta/dependency";
  const metaUri = "https://example.test/meta/custom";
  const result = await prepare(
    { $schema: metaUri, type: "string" },
    {
      externalSchemas: {
        [dependencyUri]: {
          $id: dependencyUri,
          $schema: "https://json-schema.org/draft/2020-12/schema",
        },
        [metaUri]: {
          ...customMetaschema("draft-2020-12", metaUri, {
            applicator: true,
            core: true,
            validation: true,
          }),
          allOf: [{ $ref: dependencyUri }],
        },
      },
    },
  );

  assert.equal(result.ok, true);
});

void test("registers an embedded resource required by a custom metaschema", async () => {
  const dependencyUri = "https://example.test/meta/embedded-dependency";
  const metaUri = "https://example.test/meta/custom-with-embedded-dependency";
  const result = await prepare(
    { $schema: metaUri, type: "string" },
    {
      externalSchemas: {
        [metaUri]: {
          ...customMetaschema("draft-2020-12", metaUri, {
            applicator: true,
            core: true,
            validation: true,
          }),
          $defs: { dependency: { $id: dependencyUri, type: "object" } },
          allOf: [{ $ref: dependencyUri }],
        },
      },
    },
  );

  assert.equal(result.ok, true);
});

void test("quarantines references in unused custom metaschema declarations", async () => {
  const unusedUri = "https://example.test/meta/unused-invalid-dependency";
  const metaUri = "https://example.test/meta/custom-with-unused-dependency";
  const result = await prepare(
    { $schema: metaUri, type: "string" },
    {
      externalSchemas: {
        [metaUri]: {
          ...customMetaschema("draft-2020-12", metaUri, {
            applicator: true,
            core: true,
            validation: true,
          }),
          $defs: { unused: { $ref: unusedUri } },
        },
        [unusedUri]: { $id: unusedUri, type: 42 },
      },
    },
  );

  assert.equal(result.ok, true);
});

void test("rejects duplicate canonical targets used by a custom metaschema", async () => {
  const duplicateUri = "https://example.test/meta/duplicate-dependency";
  const firstRetrievalUri = "https://registry.example.test/a.json";
  const metaUri = "https://example.test/meta/custom-with-duplicate-dependency";
  const secondRetrievalUri = "https://registry.example.test/b.json";
  const metaschema = {
    ...customMetaschema("draft-2020-12", metaUri, {
      applicator: true,
      core: true,
      validation: true,
    }),
    allOf: [{ $ref: duplicateUri }],
  };
  const first = { $id: duplicateUri, type: "object" };
  const second = { $id: duplicateUri, required: ["value"], type: "object" };
  const registries = [
    { [firstRetrievalUri]: first, [metaUri]: metaschema, [secondRetrievalUri]: second },
    { [secondRetrievalUri]: second, [metaUri]: metaschema, [firstRetrievalUri]: first },
  ];
  const results = await Promise.all(
    registries.map(async (externalSchemas) => {
      const result = await prepare({ $schema: metaUri, type: "string" }, { externalSchemas });
      return result;
    }),
  );

  for (const result of results) {
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /identifier is not unique/u);
  }
});

void test("projects nested dialect resources while registering a selected external", async () => {
  const resourceUri = "https://example.test/resource/with-legacy";
  const result = await prepare(
    { $ref: resourceUri },
    {
      externalSchemas: {
        [resourceUri]: {
          $defs: {
            legacy: {
              $id: "legacy",
              $schema: "https://json-schema.org/draft-07/schema#",
              additionalItems: false,
              items: [{ type: "string" }],
              type: "array",
            },
          },
          $id: resourceUri,
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "string",
        },
      },
    },
  );

  assert.equal(result.ok, true);
});

void test("rejects duplicate identifiers inside a selected custom metaschema", async () => {
  const metaUri = "https://example.test/meta/duplicates";
  const result = await prepare(
    { $schema: metaUri, type: "string" },
    {
      externalSchemas: {
        [metaUri]: {
          ...customMetaschema("draft-2020-12", metaUri, {
            applicator: true,
            core: true,
            validation: true,
          }),
          $defs: { first: { $id: "duplicate" }, second: { $id: "duplicate" } },
        },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.diagnostics[0].message, /identifier is not unique/u);
});
