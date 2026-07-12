import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const fixtureSchema = (): JsonSchemaValue => ({
  $defs: {
    base: { properties: { version: { type: "string" } }, required: ["version"], type: "object" },
  },
  allOf: [
    { $ref: "#/$defs/base", properties: { source: { type: "string" } }, required: ["source"] },
    {
      properties: {
        enabled: { type: "boolean" },
        options: {
          properties: { channel: { type: "string" } },
          required: ["channel"],
          type: "object",
          unevaluatedProperties: { type: "number" },
        },
      },
      required: ["enabled", "options"],
      type: "object",
    },
  ],
  properties: { label: { type: "string" } },
  required: ["label"],
  type: "object",
  unevaluatedProperties: { type: "number" },
});

void describe("JSON Schema unevaluatedProperties required keys", () => {
  void test("applies direct unevaluatedProperties to required undeclared keys", async () => {
    const closed = await compileGeneratedSchema({
      required: ["token"],
      type: "object",
      unevaluatedProperties: false,
    });
    const numeric = await compileGeneratedSchema({
      required: ["retries"],
      type: "object",
      unevaluatedProperties: { type: "number" },
    });

    assert.equal(closed.generatedSchema.safeParse({ token: "secret" }).success, false);
    assert.equal(numeric.generatedSchema.safeParse({ retries: 2 }).success, true);
    assert.equal(numeric.generatedSchema.safeParse({ retries: "two" }).success, false);
    assert.equal(numeric.generatedSchema.safeParse({ retries: 2, timeout: 30 }).success, true);
    assert.equal(
      numeric.generatedSchema.safeParse({ retries: 2, timeout: "thirty" }).success,
      false,
    );
  });

  void test("applies merged unevaluatedProperties to required undeclared keys", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      allOf: [{ required: ["retries"], type: "object" }],
      type: "object",
      unevaluatedProperties: { type: "number" },
    });

    assert.equal(generatedSchema.safeParse({ retries: 2 }).success, true);
    assert.equal(generatedSchema.safeParse({ retries: "two" }).success, false);
  });
});

void describe("JSON Schema schema-valued unevaluatedProperties", () => {
  void test("fails before narrowing a root that also permits non-object values", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "mixed-root", kind: "inline" },
        text: JSON.stringify({
          allOf: [{ properties: { name: { type: "string" } } }],
          type: ["object", "null"],
          unevaluatedProperties: false,
        }),
      },
      output: { typeName: "MixedRoot" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "unrepresentable_schema_combination",
      ),
    );
  });

  void test("fails before dropping branch-local object assertions", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "branch-assertion", kind: "inline" },
        text: JSON.stringify({
          allOf: [
            { additionalProperties: false, type: "object" },
            { properties: { name: { type: "string" } }, type: "object" },
          ],
          type: "object",
          unevaluatedProperties: false,
        }),
      },
      output: { typeName: "BranchAssertion" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "unrepresentable_schema_combination",
      ),
    );
  });

  void test("constrains only properties left unevaluated by allOf", async () => {
    const { generatedSchema: schema, source } = await compileGeneratedSchema(fixtureSchema());
    const validValue = {
      enabled: true,
      extra: 1,
      label: "tool",
      options: { channel: "stable", retries: 2 },
      source: "project",
      version: "1.0.0",
    };

    assert.ok(source.includes(".catchall"));
    assert.equal(schema.safeParse(validValue).success, true);
    assert.equal(schema.safeParse({ ...validValue, extra: "one" }).success, false);
    assert.equal(
      schema.safeParse({
        enabled: true,
        label: "tool",
        options: validValue.options,
        source: "project",
        version: "1.0.0",
      }).success,
      true,
    );
    assert.equal(
      schema.safeParse({ ...validValue, options: { channel: "stable", retries: "two" } }).success,
      false,
    );
    assert.equal(
      schema.safeParse({ extra: 1, label: "tool", options: validValue.options, version: "1.0.0" })
        .success,
      false,
    );
    assert.equal(
      schema.safeParse({ enabled: true, options: validValue.options, version: "1.0.0" }).success,
      false,
    );
  });
});
