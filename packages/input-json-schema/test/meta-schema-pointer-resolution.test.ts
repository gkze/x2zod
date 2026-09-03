import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaValue } from "../src/document";

const draft2020SchemaUri = "https://json-schema.org/draft/2020-12/schema";
const bundleUri = "https://example.test/meta/pointer-bundle";
const pointerMetaUri = "https://example.test/meta/pointer-target";

const prepareType = async (
  type: string,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  schemaUri: string,
): Promise<Awaited<ReturnType<typeof jsonSchemaInputPlugin.prepare>>> => {
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: `pointer-meta-${type}`, kind: "inline" },
      text: JSON.stringify({ $schema: schemaUri, type }),
    },
    jsonSchemaInputPluginOptionsSchema.parse({ externalSchemas }),
  );
  return result;
};

void test("resolves a custom metaschema through a JSON Pointer in an external bundle", async () => {
  const externalSchemas = {
    [bundleUri]: {
      examples: [
        {
          $id: pointerMetaUri,
          $schema: draft2020SchemaUri,
          properties: { type: { const: "string" } },
          type: "object",
        },
      ],
    },
  };

  const schemaUri = `${bundleUri}#/examples/0`;
  const valid = await prepareType("string", externalSchemas, schemaUri);
  const invalid = await prepareType("number", externalSchemas, schemaUri);

  assert.equal(valid.ok, true, valid.ok ? undefined : valid.diagnostics[0].message);
  assert.equal(invalid.ok, false, invalid.ok ? "expected custom meta-schema rejection" : undefined);
});

void test("materializes pointer dependencies reachable from a custom metaschema", async () => {
  const externalSchemas = {
    [bundleUri]: {
      examples: [
        {
          $id: pointerMetaUri,
          $schema: draft2020SchemaUri,
          allOf: [{ $ref: "#/examples/0" }],
          examples: [{ properties: { type: { const: "string" } }, type: "object" }],
        },
      ],
    },
  };

  const schemaUri = `${bundleUri}#/examples/0`;
  const valid = await prepareType("string", externalSchemas, schemaUri);
  const invalid = await prepareType("number", externalSchemas, schemaUri);

  assert.equal(valid.ok, true, valid.ok ? undefined : valid.diagnostics[0].message);
  assert.equal(invalid.ok, false, invalid.ok ? "expected custom meta-schema rejection" : undefined);
});

void test("prefers an exact retrieval key over an unused canonical identifier alias", async () => {
  const exactUri = "https://example.test/meta/exact-pointer-bundle";
  const aliasUri = "https://example.test/meta/unused-alias";
  const externalSchemas = {
    [exactUri]: {
      $defs: {
        meta: {
          $id: pointerMetaUri,
          $schema: draft2020SchemaUri,
          properties: { type: { const: "string" } },
          type: "object",
        },
      },
    },
    [aliasUri]: { $id: exactUri },
  };

  const schemaUri = `${exactUri}#/$defs/meta`;
  const valid = await prepareType("string", externalSchemas, schemaUri);
  const invalid = await prepareType("number", externalSchemas, schemaUri);

  assert.equal(valid.ok, true, valid.ok ? undefined : valid.diagnostics[0].message);
  assert.equal(invalid.ok, false, invalid.ok ? "expected custom meta-schema rejection" : undefined);
});

void test("rejects oscillating resource dialect discovery", async () => {
  const metaUri = "https://example.test/meta/oscillating";
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "oscillating-resource-dialect", kind: "inline" },
      text: JSON.stringify({
        $defs: { meta: { $id: metaUri, $schema: "http://json-schema.org/draft-07/schema#" } },
        $schema: metaUri,
        type: "string",
      }),
    },
    jsonSchemaInputPluginOptionsSchema.parse({ validator: "none" }),
  );

  assert.equal(result.ok, false);
  assert.match(result.diagnostics[0].message, /dialect discovery did not converge/u);
});

void test("does not traverse a pointer target's owning resource root", async () => {
  const targetUri = "https://example.test/schema/pointer-target";
  const unusedUri = "https://example.test/schema/unused-owner-reference";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [targetUri]: { $ref: unusedUri, examples: [{ type: "string" }] },
      [unusedUri]: { $id: "#%ZZ", type: "number" },
    },
    validator: "none",
  });
  const prepared = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "pointer-owner-scope", kind: "inline" },
      text: JSON.stringify({ $ref: `${targetUri}#/examples/0` }),
    },
    options,
  );
  assert.equal(prepared.ok, true);

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, options);

  assert.equal(lowered.ok, true, lowered.ok ? undefined : lowered.diagnostics[0].message);
});
