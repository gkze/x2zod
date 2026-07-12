import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";

const malformedTypeEntry = 7;

const assertCompileDiagnostic = async (
  id: string,
  schema: JsonSchemaValue,
  diagnosticCode: string,
): Promise<void> => {
  const result = await compileToZodSource({
    document: { source: { id, kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "CompositionDiagnostic" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  if (result.ok) assert.fail(`Expected ${id} to fail compilation.`);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === diagnosticCode));
};

void describe("JSON Schema composition diagnostics", () => {
  void test("fails before unsafe strict-object sibling intersections", async () => {
    await assertCompileDiagnostic(
      "strict-ref-sibling",
      {
        $defs: {
          base: {
            additionalProperties: false,
            properties: { base: { type: "string" } },
            type: "object",
          },
        },
        $ref: "#/$defs/base",
        properties: { extra: { type: "string" } },
        type: "object",
      },
      "unrepresentable_schema_combination",
    );
  });

  void test("fails before unsafe strict-object allOf intersections", async () => {
    await assertCompileDiagnostic(
      "strict-all-of",
      {
        allOf: [
          {
            additionalProperties: false,
            properties: { alpha: { type: "string" } },
            type: "object",
          },
          { properties: { beta: { type: "string" } }, type: "object" },
        ],
      },
      "unrepresentable_schema_combination",
    );
  });

  void test("fails before intersecting propertyNames with a strict object boundary", async () => {
    await assertCompileDiagnostic(
      "property-names-strict-object",
      { propertyNames: { pattern: "^x" }, type: "object", unevaluatedProperties: false },
      "unrepresentable_schema_combination",
    );
  });

  void test("fails before narrowing non-object values with untyped object siblings", async () => {
    await assertCompileDiagnostic(
      "primitive-const-object-sibling",
      { const: "source", properties: { name: { type: "string" } } },
      "unrepresentable_schema_combination",
    );
  });

  void test("fails before narrowing non-array values with untyped array siblings", async () => {
    await Promise.all(
      (
        [
          ["primitive-const-array-sibling", { const: "source", items: { type: "string" } }],
          ["primitive-enum-array-sibling", { enum: ["source"], minItems: 1 }],
          [
            "primitive-ref-array-sibling",
            {
              $defs: { value: { type: "string" } },
              $ref: "#/$defs/value",
              items: { type: "string" },
            },
          ],
        ] satisfies readonly (readonly [string, JsonSchemaValue])[]
      ).map(async ([id, schema]) => {
        await assertCompileDiagnostic(id, schema, "unrepresentable_schema_combination");
      }),
    );
  });
});

void describe("JSON Schema composition validation diagnostics", () => {
  void test("recursively diagnoses unsupported unevaluatedProperties schemas", async () => {
    await assertCompileDiagnostic(
      "unsupported-unevaluated-properties-schema",
      { type: "object", unevaluatedProperties: { type: "array", uniqueItems: true } },
      "unsupported_keyword",
    );
  });

  void test("does not erase malformed redundant type arrays", async () => {
    await assertCompileDiagnostic(
      "malformed-const-type",
      { const: 1, type: ["number", malformedTypeEntry] },
      "invalid_schema_document",
    );
    await assertCompileDiagnostic(
      "malformed-enum-type",
      { enum: [1], type: ["number", "bogus"] },
      "invalid_schema_document",
    );
    await assertCompileDiagnostic(
      "malformed-ref-type",
      {
        $defs: { value: { type: "object" } },
        $ref: "#/$defs/value",
        type: ["object", malformedTypeEntry],
      },
      "invalid_schema_document",
    );
  });

  void test("fails before intersecting duplicate merged object properties", async () => {
    await assertCompileDiagnostic(
      "duplicate-merged-property",
      {
        allOf: [
          {
            properties: {
              nested: {
                additionalProperties: false,
                properties: { alpha: { type: "string" } },
                type: "object",
              },
            },
          },
          { properties: { nested: { properties: { beta: { type: "string" } }, type: "object" } } },
        ],
        type: "object",
        unevaluatedProperties: false,
      },
      "unrepresentable_schema_combination",
    );
  });

  void test("retains composition keyword-shape validation in specialized lowering", async () => {
    await assertCompileDiagnostic(
      "empty-any-of",
      {
        anyOf: [],
        properties: { run: { type: "string" } },
        type: "object",
        unevaluatedProperties: false,
      },
      "invalid_schema_document",
    );
    await assertCompileDiagnostic(
      "duplicate-required",
      {
        anyOf: [{ required: ["run", "run"] }],
        properties: { run: { type: "string" } },
        type: "object",
        unevaluatedProperties: false,
      },
      "invalid_schema_document",
    );
  });
});
