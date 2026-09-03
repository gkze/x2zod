import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaValue } from "../src/document";

const draft2020SchemaUri = "https://json-schema.org/draft/2020-12/schema";

const prepareWithSelectedExternals = async (
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  references: readonly string[],
): Promise<Awaited<ReturnType<typeof jsonSchemaInputPlugin.prepare>>> => {
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { id: "preflight-isolation", kind: "inline" },
      text: JSON.stringify({
        $schema: draft2020SchemaUri,
        allOf: references.map(($ref) => ({ $ref })),
        type: "string",
      }),
    },
    jsonSchemaInputPluginOptionsSchema.parse({ externalSchemas }),
  );
  return result;
};

void test("isolates unused nested identifiers across selected same-dialect documents", async () => {
  const firstUri = "https://example.test/resource/first-same-dialect";
  const secondUri = "https://example.test/resource/second-same-dialect";
  const sharedNestedId = "urn:example:unused-same-dialect";
  const result = await prepareWithSelectedExternals(
    {
      [firstUri]: {
        $defs: { unused: { $id: sharedNestedId, type: "string" } },
        $id: firstUri,
        type: "string",
      },
      [secondUri]: {
        $defs: { unused: { $id: sharedNestedId, type: "number" } },
        $id: secondUri,
        type: "string",
      },
    },
    [firstUri, secondUri],
  );

  assert.equal(result.ok, true);
});

void test("isolates unused root identifiers across selected documents", async () => {
  const firstUri = "https://example.test/resource/first-retrieval";
  const secondUri = "https://example.test/resource/second-retrieval";
  const sharedId = "urn:example:unused-root-alias";
  const result = await prepareWithSelectedExternals(
    {
      [firstUri]: { $id: sharedId, type: "string" },
      [secondUri]: { $id: sharedId, type: "string" },
    },
    [firstUri, secondUri],
  );

  assert.equal(result.ok, true);
});
