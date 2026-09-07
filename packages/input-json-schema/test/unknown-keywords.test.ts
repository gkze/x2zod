import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";
import type { CompileToZodSourceResult } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";

const compileSchema = async (
  schema: JsonSchemaValue,
  pluginOptions: JsonSchemaInputPluginOptionsInput = {},
): Promise<CompileToZodSourceResult> => {
  const result = await compileToZodSource({
    document: { source: { id: "unknown-keywords", kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "UnknownKeywordSchema" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions,
  });
  return result;
};

const diagnosticPointers = (
  result: CompileToZodSourceResult,
  code: string,
): readonly (string | undefined)[] =>
  (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.code === code)
    .map((diagnostic) => diagnostic.location?.pointer)
    .toSorted((left, right) => (left ?? "").localeCompare(right ?? ""));

void test("unknown keywords support explicit strict rejection", async () => {
  const result = await compileSchema(
    { type: "string", xTaplo: { docs: {} } },
    { unknownKeywords: "reject" },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticPointers(result, "unknown_keyword"), ["/xTaplo"]);
});

void test("warn policy accepts cross-dialect vendor extensions with per-occurrence warnings", async () => {
  const result = await compileSchema(
    {
      properties: {
        name: { type: "string", xTaplo: { docs: { enumValues: [] } } },
        tags: { items: { type: "string", xTaplo: true }, type: "array" },
      },
      type: "object",
      xTombiTableKeysOrder: "schema",
    },
    { unknownKeywords: "warn", validator: "none" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(diagnosticPointers(result, "json-schema/ignored-keyword"), [
    "/properties/name/xTaplo",
    "/properties/tags/items/xTaplo",
    "/xTombiTableKeysOrder",
  ]);
  assert.ok(
    result.diagnostics?.every(
      (diagnostic) =>
        diagnostic.code !== "json-schema/ignored-keyword" || diagnostic.severity === "warning",
    ) === true,
  );
});

void test("ignore policy accepts vendor extensions silently", async () => {
  const result = await compileSchema(
    { type: "string", xTaplo: { docs: { enumValues: [] } } },
    { unknownKeywords: "ignore", validator: "none" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(diagnosticPointers(result, "json-schema/ignored-keyword"), []);
});

void test("generic policy never accepts cross-dialect keywords", async () => {
  const result = await compileSchema(
    { $ref: "#/definitions/value", definitions: { value: { type: "string" } } },
    { dialect: "draft-2020-12", unknownKeywords: "ignore", validator: "none" },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticPointers(result, "unknown_keyword"), ["/definitions"]);
});

void test("generic policy never accepts the dollar-reserved namespace", async () => {
  const result = await compileSchema(
    { $vendor: true, type: "string" },
    { unknownKeywords: "ignore", validator: "none" },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticPointers(result, "unknown_keyword"), ["/$vendor"]);
});

void test("configured inert keywords take precedence over the generic policy", async () => {
  const result = await compileSchema(
    { type: "string", xStringMetadata: "value" },
    { inertKeywords: { xStringMetadata: "boolean" }, unknownKeywords: "warn", validator: "none" },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticPointers(result, "invalid_schema_document"), ["/xStringMetadata"]);
});

void test("warn policy keeps vendor siblings out of intersection lowering", async () => {
  const result = await compileSchema(
    {
      anyOf: [{ type: "string" }, { type: "number" }],
      type: "string",
      xTaplo: { docs: { enumValues: [] } },
    },
    { dialect: "draft-2020-12", unknownKeywords: "warn", validator: "none" },
  );

  assert.equal(result.ok, true);
});

for (const validator of ["ajv", "none"] as const)
  void test(`unknown keywords warn by default with ${validator}`, async () => {
    const result = await compileSchema(
      { type: "string", vendor: { anyOf: ["opaque"] } },
      { validator },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(diagnosticPointers(result, "json-schema/ignored-keyword"), ["/vendor"]);
  });
