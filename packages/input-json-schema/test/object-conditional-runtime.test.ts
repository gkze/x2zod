import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";
import type { ZodEmissionTransformInput } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";
import { jsonSchemaKeywords } from "../src/metadata";
import { compileGeneratedSchema } from "./generated-schema-harness";

const assertRuntimeResults = async (
  schema: JsonSchemaValue,
  accepted: readonly unknown[],
  rejected: readonly unknown[],
): Promise<void> => {
  const { generatedSchema, source } = await compileGeneratedSchema(schema);

  for (const value of accepted) {
    const result = generatedSchema.safeParse(value);
    assert.equal(result.success, true, `expected acceptance for ${JSON.stringify(value)}`);
    assert.deepEqual(result.data, value);
  }
  for (const value of rejected)
    assert.equal(
      generatedSchema.safeParse(value).success,
      false,
      `expected rejection for ${JSON.stringify(value)}`,
    );

  assert.match(source, /x2zodRuntimeProgram/u);
};

const propertyTransforms = [
  { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
] as const satisfies readonly ZodEmissionTransformInput[];

void describe("object and conditional exact runtime keywords", () => {
  void test("keeps malformed runtime-only keywords as invalid schemas", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "invalid-min-properties", kind: "inline" },
        text: JSON.stringify({ minProperties: -1, type: "object" }),
      },
      output: { typeName: "InvalidMinProperties" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "ajv" },
    });

    assert.equal(result.ok, false);
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.code === "invalid_schema_document"),
      true,
    );
  });

  void test("preserves dependentRequired and dependentSchemas", async () => {
    await assertRuntimeResults(
      {
        dependentRequired: { creditCard: ["billingAddress"] },
        dependentSchemas: {
          country: {
            properties: { postalCode: { pattern: "^[0-9]{5}$", type: "string" } },
            required: ["postalCode"],
          },
        },
        type: "object",
      },
      [{}, { billingAddress: "here", creditCard: 1 }, { country: "US", postalCode: "90210" }],
      [{ creditCard: 1 }, { country: "US" }, { country: "US", postalCode: "invalid" }],
    );
  });

  void test("preserves if, then, and else", async () => {
    await assertRuntimeResults(
      {
        else: { properties: { value: { type: "number" } }, required: ["value"] },
        if: { properties: { kind: { const: "text" } }, required: ["kind"] },
        [jsonSchemaKeywords.thenKeyword]: {
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        type: "object",
      },
      [
        { kind: "text", value: "ok" },
        { kind: "number", value: 1 },
      ],
      [
        { kind: "text", value: 1 },
        { kind: "number", value: "wrong" },
      ],
    );
  });

  void test("preserves patternProperties with minProperties and maxProperties", async () => {
    await assertRuntimeResults(
      {
        additionalProperties: false,
        maxProperties: 2,
        minProperties: 1,
        patternProperties: { "^S_": { type: "string" } },
        type: "object",
      },
      [{ S_name: "Ada" }, { S_first: "Ada", S_last: "Lovelace" }],
      [{}, { S_name: 1 }, { other: "Ada" }, { S_a: "a", S_b: "b", S_c: "c" }],
    );
  });

  void test("reports unknown keywords in runtime-only child schemas", async () => {
    const schemas = [
      { dependentSchemas: { trigger: { inventedKeyword: true } } },
      { if: { inventedKeyword: true } },
      { patternProperties: { "^x": { inventedKeyword: true } } },
    ] as const;

    const results = await Promise.all(
      schemas.map(async (schema, index) => {
        const result = await compileToZodSource({
          document: {
            source: { id: `nested-runtime-${index.toString()}`, kind: "inline" },
            text: JSON.stringify(schema),
          },
          output: { typeName: "NestedRuntime" },
          plugin: jsonSchemaInputPlugin,
          pluginOptions: { validator: "none" },
        });
        return result;
      }),
    );

    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(
        result.diagnostics.some((diagnostic) => diagnostic.code === "unknown_keyword"),
        true,
      );
    }
  });
});

void describe("object property-key transforms", () => {
  for (const boundary of [false, { type: "number" }] as const)
    void test(`preserves required pattern keys with ${JSON.stringify(boundary)} additional properties`, async () => {
      const { generatedSchema } = await compileGeneratedSchema(
        {
          additionalProperties: boundary,
          patternProperties: { "^x_": { type: "string" } },
          properties: { user_id: { type: "string" } },
          required: ["user_id", "x_name"],
          type: "object",
        },
        { transforms: propertyTransforms },
      );
      const result = generatedSchema.safeParse({ user_id: "user-1", x_name: "Ada" });
      assert.equal(result.success, true);
      assert.deepEqual(result.data, { userId: "user-1", xName: "Ada" });
      assert.equal(generatedSchema.safeParse({ user_id: "user-1" }).success, false);
      assert.equal(generatedSchema.safeParse({ user_id: "user-1", x_name: 1 }).success, false);
    });

  void test("keeps patterned additional values outside the structural catchall", async () => {
    const { generatedSchema } = await compileGeneratedSchema(
      {
        additionalProperties: { type: "number" },
        patternProperties: { "^x_": { type: "string" } },
        properties: { user_id: { type: "string" } },
        required: ["user_id"],
        type: "object",
      },
      { transforms: propertyTransforms },
    );
    const result = generatedSchema.safeParse({ user_id: "user-1", x_name: "Ada", other: 1 });
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { userId: "user-1", x_name: "Ada", other: 1 });
    assert.equal(generatedSchema.safeParse({ user_id: "user-1", other: "invalid" }).success, false);
  });

  void test("preserves dynamic pattern keys", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema(
      {
        additionalProperties: false,
        patternProperties: { "^x_": { type: "string" } },
        properties: { user_id: { type: "string" } },
        required: ["user_id"],
        type: "object",
      },
      { transforms: propertyTransforms },
    );

    const accepted = generatedSchema.safeParse({ user_id: "user-1", x_name: "Ada" });
    assert.equal(accepted.success, true);
    assert.deepEqual(accepted.data, { userId: "user-1", x_name: "Ada" });
    assert.equal(generatedSchema.safeParse({ user_id: "user-1", x_name: 1 }).success, false);
    assert.equal(generatedSchema.safeParse({ user_id: "user-1", other: "Ada" }).success, false);
    assert.match(source, /z\.codec/u);
    assert.match(source, /x2zodRuntimeProgram/u);
  });
});
