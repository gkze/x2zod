import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaValue } from "../src/document";

const draft7SchemaUri = "http://json-schema.org/draft-07/schema#";
const draft2020SchemaUri = "https://json-schema.org/draft/2020-12/schema";

void test("evaluates a custom metaschema across resource dialects", async () => {
  const dependencyUri = "https://example.test/meta/draft-7-dependency";
  const metaUri = "https://example.test/meta/cross-dialect";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [dependencyUri]: {
        $id: dependencyUri,
        $schema: draft7SchemaUri,
        properties: { type: { enum: ["string"] } },
        type: "object",
      },
      [metaUri]: {
        $id: metaUri,
        $schema: draft2020SchemaUri,
        $vocabulary: {
          "https://json-schema.org/draft/2020-12/vocab/applicator": true,
          "https://json-schema.org/draft/2020-12/vocab/core": true,
          "https://json-schema.org/draft/2020-12/vocab/validation": true,
        },
        allOf: [{ $ref: dependencyUri }],
      },
    },
  });
  const document = (type: string): Parameters<typeof jsonSchemaInputPlugin.prepare>[0] => ({
    source: { id: `cross-dialect-${type}`, kind: "inline" } as const,
    text: JSON.stringify({ $schema: metaUri, type }),
  });
  const valid = await jsonSchemaInputPlugin.prepare(document("string"), options);
  const invalid = await jsonSchemaInputPlugin.prepare(document("number"), options);
  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
});

void test("resolves an embedded custom metaschema for a compound resource", async () => {
  const metaUri = "https://example.test/meta/embedded";
  const modelUri = "https://example.test/model/embedded-meta";
  const schema = {
    $schema: draft2020SchemaUri,
    $defs: {
      meta: {
        $id: metaUri,
        $schema: draft2020SchemaUri,
        $vocabulary: {
          "https://json-schema.org/draft/2020-12/vocab/applicator": true,
          "https://json-schema.org/draft/2020-12/vocab/core": true,
          "https://json-schema.org/draft/2020-12/vocab/validation": true,
        },
        properties: { type: { const: "string" } },
        type: "object",
      },
      model: { $id: modelUri, $schema: metaUri, type: "string" },
    },
    $ref: modelUri,
  };
  const result = await jsonSchemaInputPlugin.prepare(
    { source: { id: "embedded-custom-meta", kind: "inline" }, text: JSON.stringify(schema) },
    jsonSchemaInputPluginOptionsSchema.parse({}),
  );

  assert.equal(result.ok, true);
});

void test("discovers a custom metaschema embedded in an external compound document", async () => {
  const bundleUri = "https://example.test/meta/bundle";
  const metaUri = "https://example.test/meta/embedded-resource";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [bundleUri]: {
        $id: bundleUri,
        $schema: draft2020SchemaUri,
        $defs: {
          meta: {
            $id: metaUri,
            $schema: draft2020SchemaUri,
            $vocabulary: {
              "https://json-schema.org/draft/2020-12/vocab/applicator": true,
              "https://json-schema.org/draft/2020-12/vocab/core": true,
              "https://json-schema.org/draft/2020-12/vocab/validation": true,
            },
            properties: { type: { const: "string" } },
            type: "object",
          },
        },
      },
    },
  });
  const document = (type: string): Parameters<typeof jsonSchemaInputPlugin.prepare>[0] => ({
    source: { id: `external-embedded-meta-${type}`, kind: "inline" } as const,
    text: JSON.stringify({ $schema: metaUri, type }),
  });
  const valid = await jsonSchemaInputPlugin.prepare(document("string"), options);
  const invalid = await jsonSchemaInputPlugin.prepare(document("number"), options);
  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
});

void test("preflights every resource beside a selected embedded custom metaschema", async () => {
  const bundleUri = "https://example.test/meta/selected-bundle";
  const metaUri = "urn:example:selected-embedded-meta";
  const externalSchemas = (bad: JsonSchemaValue): Readonly<Record<string, JsonSchemaValue>> => ({
    [bundleUri]: {
      $id: bundleUri,
      $schema: draft2020SchemaUri,
      $defs: {
        bad,
        meta: {
          $id: metaUri,
          $schema: draft2020SchemaUri,
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/applicator": true,
            "https://json-schema.org/draft/2020-12/vocab/core": true,
            "https://json-schema.org/draft/2020-12/vocab/validation": true,
          },
          type: "object",
        },
      },
    },
  });
  const document = {
    source: { id: "selected-embedded-meta-bundle", kind: "inline" } as const,
    text: JSON.stringify({ $schema: metaUri, type: "string" }),
  };
  const invalidSyntax = await jsonSchemaInputPlugin.prepare(
    document,
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: externalSchemas({
        $id: "urn:example:selected-bad-syntax",
        $schema: draft2020SchemaUri,
        type: "nonsense",
      }),
    }),
  );
  const invalidIdentifier = await jsonSchemaInputPlugin.prepare(
    document,
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: externalSchemas({
        $id: "http://[",
        $schema: draft2020SchemaUri,
        type: "string",
      }),
    }),
  );

  assert.equal(invalidSyntax.ok, false);
  assert.equal(invalidIdentifier.ok, false);
});

const embeddedMetaDependencyResult = async (
  dependency: JsonSchemaValue,
): ReturnType<typeof jsonSchemaInputPlugin.prepare> => {
  const bundleUri = "https://example.test/meta/embedded-meta-dependency-bundle";
  const dependencyUri = "https://example.test/meta/bad-dep";
  const metaUri = "urn:example:embedded-meta-dep";
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "embedded-custom-meta-dependency", kind: "inline" },
      text: JSON.stringify({ $schema: metaUri, type: "string" }),
    },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [bundleUri]: {
          $defs: {
            meta: {
              $id: metaUri,
              $schema: draft2020SchemaUri,
              $vocabulary: {
                "https://json-schema.org/draft/2020-12/vocab/applicator": true,
                "https://json-schema.org/draft/2020-12/vocab/core": true,
                "https://json-schema.org/draft/2020-12/vocab/validation": true,
              },
              allOf: [{ $ref: dependencyUri }],
            },
          },
          $id: bundleUri,
          $schema: draft2020SchemaUri,
        },
        [dependencyUri]: dependency,
      },
    }),
  );
  return result;
};

for (const [description, dependency] of [
  ["malformed identifier", { $id: "http://[", $schema: draft2020SchemaUri }],
  [
    "invalid schema syntax",
    { $id: "https://example.test/meta/bad-dep", $schema: draft2020SchemaUri, description: 42 },
  ],
] as const)
  void test(`rejects an embedded custom metaschema dependency with ${description}`, async () => {
    const result = await embeddedMetaDependencyResult(dependency);

    assert.equal(result.ok, false);
  });

for (const validator of ["ajv", "none"] as const)
  void test(`rejects an unknown keyword used by a custom metaschema with ${validator}`, async () => {
    const baseUri = "urn:example:base-optional-unknown";
    const metaUri = "urn:example:meta-using-unknown";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [baseUri]: {
          $id: baseUri,
          $schema: draft2020SchemaUri,
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/core": true,
            "urn:example:vocab:unknown": false,
          },
        },
        [metaUri]: { $id: metaUri, $schema: baseUri, type: "object", xMustBeString: true },
      },
      validator,
    });
    const prepared = await jsonSchemaInputPlugin.prepare(
      {
        source: { id: `custom-meta-unknown-${validator}`, kind: "inline" },
        text: JSON.stringify({ $schema: metaUri, type: "number" }),
      },
      options,
    );

    if (validator === "none") assert.equal(prepared.ok, true);
    const result =
      validator === "none" && prepared.ok
        ? await jsonSchemaInputPlugin.lower(prepared.value, options)
        : prepared;
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find(({ code }) => code === "unknown_keyword");
    assert.ok(diagnostic);
    assert.equal(diagnostic.location?.pointer, "/xMustBeString");
  });

void test("preflights embedded resources under an inherited disabled validation vocabulary", async () => {
  const metaUri = "urn:example:no-validation-embedded-resource";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [metaUri]: {
        $id: metaUri,
        $schema: draft2020SchemaUri,
        $vocabulary: {
          "https://json-schema.org/draft/2020-12/vocab/applicator": true,
          "https://json-schema.org/draft/2020-12/vocab/core": true,
        },
        type: "object",
      },
    },
  });
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "no-validation-embedded-resource", kind: "inline" },
      text: JSON.stringify({
        $defs: { child: { $id: "child", type: 42 } },
        $schema: metaUri,
        type: 42,
      }),
    },
    options,
  );

  assert.equal(result.ok, true, result.ok ? undefined : result.diagnostics[0].message);
});

void test("does not infer a custom dialect from an ignored Draft 7 $ref sibling", async () => {
  const metaUri = "urn:example:ignored-draft-7-sibling-meta";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      "https://example.test/meta/ignored-draft-7-sibling": {
        $id: metaUri,
        $ref: "#",
        $schema: draft7SchemaUri,
      },
    },
    validator: "none",
  });
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "ignored-draft-7-sibling-meta", kind: "inline" },
      text: JSON.stringify({ $schema: metaUri, type: "string" }),
    },
    options,
  );

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "unsupported_dialect"));
});
