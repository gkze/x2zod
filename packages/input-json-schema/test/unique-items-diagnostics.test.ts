import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";

const assertCompileDiagnostic = async (
  id: string,
  schema: JsonSchemaValue,
  code: string,
): Promise<void> => {
  const result = await compileToZodSource({
    document: { source: { id, kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "UniqueItemsDiagnostic" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) => diagnostic.code === code && diagnostic.location?.pointer === "/uniqueItems",
    ),
  );
};

const assertCompiles = async (id: string, schema: JsonSchemaValue): Promise<void> => {
  const result = await compileToZodSource({
    document: { source: { id, kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "UniqueItemsTuple" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.diagnostics ?? []).some((diagnostic) => diagnostic.code === "unsupported_keyword"),
    false,
  );
};

void describe("JSON Schema uniqueItems diagnostics", () => {
  void test("keeps false ref siblings inert through property-key transforms", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "false-ref-sibling", kind: "inline" },
        text: JSON.stringify({
          $defs: {
            values: {
              items: { properties: { snake_key: { type: "string" } }, type: "object" },
              type: "array",
            },
          },
          $ref: "#/$defs/values",
          type: "array",
          uniqueItems: false,
        }),
      },
      output: { typeName: "FalseUniqueItemsSibling" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { dialect: "draft-2020-12", validator: "none" },
      transforms: [
        { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
      ],
    });

    assert.equal(result.ok, true);
  });

  void test("accepts false siblings beside Draft 7 refs", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "draft-7-false-ref-sibling", kind: "inline" },
        text: JSON.stringify({
          definitions: { values: { items: { type: "string" }, type: "array" } },
          $ref: "#/definitions/values",
          uniqueItems: false,
        }),
      },
      output: { typeName: "DraftSevenFalseUniqueItemsSibling" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { dialect: "draft-7", validator: "none" },
    });

    assert.equal(result.ok, true);
  });

  void test("diagnoses malformed values without validator preflight", async () => {
    await assertCompileDiagnostic(
      "malformed-unique-items",
      { type: "array", uniqueItems: "true" },
      "invalid_schema_document",
    );
  });

  for (const uniqueItems of [false, true])
    void test(`supports uniqueItems ${String(uniqueItems)} beside fixed prefix-item tuples`, async () => {
      await assertCompiles(`tuple-unique-items-${String(uniqueItems)}`, {
        maxItems: 2,
        minItems: 2,
        prefixItems: [{ type: "number" }, { type: "number" }],
        type: "array",
        uniqueItems,
      });
    });
});
