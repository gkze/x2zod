import assert from "node:assert/strict";
import { describe, test } from "node:test";

import AjvDraft2020 from "ajv/dist/2020.js";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";
import {
  compileGeneratedSchema,
  verifyGeneratedSchemaRuntimeIsolation,
} from "./generated-schema-harness";

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

type UnevaluatedPropertiesParityRequest = Readonly<{
  schema: JsonSchemaValue;
  values: readonly unknown[];
}>;

const assertUnevaluatedPropertiesParity = async ({
  schema,
  values,
}: UnevaluatedPropertiesParityRequest): Promise<void> => {
  const validate = new AjvDraft2020({ logger: false, strict: false }).compile(schema);
  const { generatedSchema } = await compileGeneratedSchema(schema);

  for (const value of values)
    assert.equal(
      generatedSchema.safeParse(value).success,
      validate(value),
      `generated schema should match Ajv for ${JSON.stringify(value)}`,
    );
};

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

void describe("JSON Schema unevaluatedProperties value applicability", () => {
  void test("preserves primitive values with untyped object assertions", async () => {
    const schema: JsonSchemaValue = {
      type: "object",
      unevaluatedProperties: { properties: { nested: { type: "string" } } },
    };
    await assertUnevaluatedPropertiesParity({
      schema,
      values: [
        { value: 42 },
        { value: { nested: "ok" } },
        { value: { nested: 42 } },
        { value: [1] },
      ],
    });
  });

  void test("preserves primitive values with untyped array assertions", async () => {
    const schema: JsonSchemaValue = {
      type: "object",
      unevaluatedProperties: { items: { type: "string" } },
    };
    await assertUnevaluatedPropertiesParity({
      schema,
      values: [{ value: 42 }, { value: ["ok"] }, { value: [1] }, { value: {} }],
    });
  });

  void test("preserves catchall applicability after merged lowering", async () => {
    const schema: JsonSchemaValue = {
      allOf: [{ type: "object" }],
      unevaluatedProperties: { properties: { nested: { type: "string" } } },
    };
    await assertUnevaluatedPropertiesParity({
      schema,
      values: [{ value: 42 }, { value: { nested: "ok" } }, { value: { nested: 42 } }],
    });
  });
});

void describe("JSON Schema schema-valued unevaluatedProperties", () => {
  void test("preserves root non-object values with unevaluatedProperties", async () => {
    const schema = {
      allOf: [{ properties: { name: { type: "string" } } }],
      type: ["object", "null"],
      unevaluatedProperties: false,
    } satisfies JsonSchemaValue;
    const result = await compileToZodSource({
      document: { source: { id: "mixed-root", kind: "inline" }, text: JSON.stringify(schema) },
      output: { typeName: "MixedRoot" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, true);
    const { generatedSchema } = await compileGeneratedSchema(schema);
    for (const [value, accepted] of [
      [null, true],
      [{}, true],
      [{ name: "tool" }, true],
      [{ name: 1 }, false],
      [1, false],
    ] as const) {
      const input = structuredClone(value);
      const parsed = generatedSchema.safeParse(input);
      assert.equal(parsed.success, accepted);
      if (parsed.success) assert.deepEqual(parsed.data, value);
      assert.deepEqual(input, value);
    }
  });

  void test("preserves branch-local object assertions with unevaluatedProperties", async () => {
    const schema = {
      allOf: [
        { additionalProperties: false, type: "object" },
        { properties: { name: { type: "string" } }, type: "object" },
      ],
      type: "object",
      unevaluatedProperties: false,
    } satisfies JsonSchemaValue;
    const result = await compileToZodSource({
      document: {
        source: { id: "branch-assertion", kind: "inline" },
        text: JSON.stringify(schema),
      },
      output: { typeName: "BranchAssertion" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, true);
    const { generatedSchema } = await compileGeneratedSchema(schema);
    for (const [value, accepted] of [
      [{}, true],
      [{ name: "tool" }, false],
      [{ name: 1 }, false],
      [null, false],
    ] as const) {
      const input = structuredClone(value);
      const parsed = generatedSchema.safeParse(input);
      assert.equal(parsed.success, accepted);
      if (parsed.success) assert.deepEqual(parsed.data, value);
      assert.deepEqual(input, value);
    }
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

void test("routes a reachable external unevaluatedProperties schema through the evaluator", async () => {
  const externalUri = "https://example.com/model.schema.json";
  const { generatedSchema, source } = await compileGeneratedSchema(
    { $ref: externalUri },
    {
      externalSchema: {
        $id: externalUri,
        allOf: [{ properties: { name: { type: "string" } } }],
        unevaluatedProperties: false,
      },
    },
  );

  assert.match(source, /x2zodEvaluate/u);
  assert.equal(generatedSchema.safeParse({ name: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ name: 42 }).success, false);
  assert.equal(generatedSchema.safeParse({ extra: true, name: "accepted" }).success, false);
});

void test("terminates a same-instance reference cycle across resources", async () => {
  const schema = {
    $defs: {
      child: { $id: "https://example.test/cycle/child", $ref: "https://example.test/cycle/root" },
    },
    $id: "https://example.test/cycle/root",
    $ref: "https://example.test/cycle/child",
    unevaluatedProperties: false,
  } satisfies JsonSchemaValue;
  const { source } = await compileGeneratedSchema(schema);

  await verifyGeneratedSchemaRuntimeIsolation({
    acceptedValues: [{}],
    rejectedValues: [{ extra: true }],
    source,
    timeoutMs: 2000,
  });
});

void test("routes an external dynamic target with unevaluatedProperties", async () => {
  const externalUri = "https://example.com/model.schema.json";
  const { generatedSchema, source } = await compileGeneratedSchema(
    { $dynamicRef: `${externalUri}#node` },
    {
      externalSchema: {
        $dynamicAnchor: "node",
        $id: externalUri,
        properties: { name: { type: "string" } },
        unevaluatedProperties: false,
      },
    },
  );

  assert.match(source, /x2zodEvaluate/u);
  assert.equal(generatedSchema.safeParse({ name: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ extra: true, name: "accepted" }).success, false);
});

void test("routes an external recursive target with unevaluatedProperties", async () => {
  const externalUri = "https://example.com/model.schema.json";
  const { generatedSchema, source } = await compileGeneratedSchema(
    { $ref: externalUri },
    {
      dialect: "draft-2019-09",
      externalSchema: {
        $id: externalUri,
        $recursiveAnchor: true,
        properties: { child: { $recursiveRef: "#" }, name: { type: "string" } },
        unevaluatedProperties: false,
      },
    },
  );

  assert.match(source, /x2zodEvaluate/u);
  assert.equal(
    generatedSchema.safeParse({ child: { name: "nested" }, name: "accepted" }).success,
    true,
  );
  assert.equal(
    generatedSchema.safeParse({ child: { extra: true }, name: "accepted" }).success,
    false,
  );
});
