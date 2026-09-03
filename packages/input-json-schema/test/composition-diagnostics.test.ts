import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const malformedTypeEntry = 7;

type CompositionRuntimeCase = Readonly<{
  accepted: readonly unknown[];
  id: string;
  rejected: readonly unknown[];
  schema: JsonSchemaValue;
}>;

const assertCompositionRuntimeParity = async ({
  accepted,
  id,
  rejected,
  schema,
}: CompositionRuntimeCase): Promise<void> => {
  const result = await compileToZodSource({
    document: { source: { id, kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "CompositionRuntime" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, true);
  const { generatedSchema } = await compileGeneratedSchema(schema);

  for (const value of accepted) {
    const input = structuredClone(value);
    const parsed = generatedSchema.safeParse(input);
    if (!parsed.success) assert.fail(`expected ${JSON.stringify(value)} to be accepted`);
    assert.deepEqual(parsed.data, value);
    assert.deepEqual(input, value);
  }

  for (const value of rejected) {
    const input = structuredClone(value);
    const parsed = generatedSchema.safeParse(input);
    assert.equal(parsed.success, false, `expected ${JSON.stringify(value)} to be rejected`);
    assert.deepEqual(input, value);
  }
};

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
  void test("preserves strict-object sibling intersection semantics at runtime", async () => {
    await assertCompositionRuntimeParity({
      accepted: [{ base: "base" }],
      id: "strict-ref-sibling",
      rejected: [{ base: "base", extra: "extra" }, { base: 1 }],
      schema: {
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
    });
  });

  void test("preserves strict-object allOf intersection semantics at runtime", async () => {
    await assertCompositionRuntimeParity({
      accepted: [{ alpha: "alpha" }],
      id: "strict-all-of",
      rejected: [{ alpha: "alpha", beta: "beta" }, { beta: "beta" }],
      schema: {
        allOf: [
          {
            additionalProperties: false,
            properties: { alpha: { type: "string" } },
            type: "object",
          },
          { properties: { beta: { type: "string" } }, type: "object" },
        ],
      },
    });
  });

  void test("preserves propertyNames and strict object boundary semantics at runtime", async () => {
    await assertCompositionRuntimeParity({
      accepted: [{}],
      id: "property-names-strict-object",
      rejected: [{ xx: 1 }, { yy: 1 }],
      schema: { propertyNames: { pattern: "^x" }, type: "object", unevaluatedProperties: false },
    });
  });

  void test("preserves non-object values with untyped object siblings", async () => {
    await assertCompositionRuntimeParity({
      accepted: ["source"],
      id: "primitive-const-object-sibling",
      rejected: ["other", { name: "source" }, 1],
      schema: { const: "source", properties: { name: { type: "string" } } },
    });
  });

  void test("preserves non-array values with untyped array siblings", async () => {
    const cases = [
      {
        accepted: ["source"],
        id: "primitive-const-array-sibling",
        rejected: ["other", ["source"], 1],
        schema: { const: "source", items: { type: "string" } },
      },
      {
        accepted: ["source"],
        id: "primitive-const-unique-sibling",
        rejected: ["other", ["source"], 1],
        schema: { const: "source", uniqueItems: true },
      },
      {
        accepted: ["source"],
        id: "primitive-enum-array-sibling",
        rejected: ["other", ["source"], 1],
        schema: { enum: ["source"], minItems: 1 },
      },
      {
        accepted: ["source", "other"],
        id: "primitive-ref-array-sibling",
        rejected: [["source"], 1],
        schema: {
          $defs: { value: { type: "string" } },
          $ref: "#/$defs/value",
          items: { type: "string" },
        },
      },
    ] satisfies readonly CompositionRuntimeCase[];

    await Promise.all(
      cases.map(async (runtimeCase) => {
        await assertCompositionRuntimeParity(runtimeCase);
      }),
    );
  });
});

void describe("JSON Schema external composition diagnostics", () => {
  void test("supports exact runtime keywords in external schemas merged through allOf", async () => {
    const externalSchemaUri = "https://schemas.example.test/base.json";
    const result = await compileToZodSource({
      document: {
        source: { id: "external-merged-schema", kind: "inline" },
        text: JSON.stringify({
          allOf: [{ $ref: `${externalSchemaUri}#/$defs/base` }],
          type: "object",
          unevaluatedProperties: { type: "number" },
        }),
      },
      output: { typeName: "ExternalMergedSchema" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: {
        externalSchemas: {
          [externalSchemaUri]: {
            $defs: {
              base: {
                properties: { tags: { contains: { type: "string" }, type: "array" } },
                type: "object",
              },
            },
          },
        },
        validator: "none",
      },
    });

    assert.equal(result.ok, true);
  });
});

void describe("JSON Schema composition validation diagnostics", () => {
  void test("supports runtime-backed schemas nested under unevaluatedProperties", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "runtime-unevaluated-properties-schema", kind: "inline" },
        text: JSON.stringify({
          type: "object",
          unevaluatedProperties: { contains: { type: "string" }, type: "array" },
        }),
      },
      output: { typeName: "RuntimeUnevaluatedProperties" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, true);
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

  void test("preserves duplicate merged object property semantics at runtime", async () => {
    await assertCompositionRuntimeParity({
      accepted: [{ nested: { alpha: "alpha" } }],
      id: "duplicate-merged-property",
      rejected: [
        { nested: { alpha: "alpha", beta: "beta" } },
        { nested: { beta: "beta" } },
        { nested: { alpha: "alpha", extra: 1 } },
      ],
      schema: {
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
    });
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
