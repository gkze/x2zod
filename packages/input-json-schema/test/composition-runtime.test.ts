import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const fractionalNumber = 1.5;

void describe("JSON Schema composition with unevaluatedProperties", () => {
  void test("fails before intersecting composition with evaluated-property bookkeeping", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "composition-unevaluated-properties", kind: "inline" },
        text: JSON.stringify({
          oneOf: [
            { properties: { left: { type: "string" } }, required: ["left"], type: "object" },
            { properties: { right: { type: "string" } }, required: ["right"], type: "object" },
          ],
          unevaluatedProperties: false,
        }),
      },
      output: { typeName: "CompositionUnevaluatedProperties" },
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

  void test("allows unevaluatedProperties when composition branches do not evaluate properties", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      anyOf: [{ required: ["run"] }, { required: ["run_windows"] }],
      properties: {
        run: { type: "string" },
        run_windows: { type: "string" },
        shell: { type: "string" },
      },
      type: "object",
      unevaluatedProperties: false,
    });

    assert.ok(source.includes("z.union"));
    assert.ok(!source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse({ run: "echo ok" }).success, true);
    assert.equal(generatedSchema.safeParse({ run_windows: "echo ok" }).success, true);
    assert.equal(
      generatedSchema.safeParse({ run: "echo ok", run_windows: "echo ok", shell: "bash" }).success,
      true,
    );
    assert.equal(generatedSchema.safeParse({ run: "echo ok", unknown: true }).success, false);
    assert.equal(generatedSchema.safeParse({ shell: "bash" }).success, false);
  });

  void test("preserves exclusive required-key choices with unevaluatedProperties", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      oneOf: [{ required: ["first"] }, { required: ["second"] }],
      properties: { first: { type: "string" }, second: { type: "string" } },
      type: "object",
      unevaluatedProperties: false,
    });

    assert.ok(source.includes("z.xor"));
    assert.ok(!source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse({ first: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ second: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ first: "yes", second: "yes" }).success, false);
    assert.equal(generatedSchema.safeParse({ first: "yes", unknown: true }).success, false);
  });
});

void describe("JSON Schema oneOf exactness", () => {
  void test("oneOf rejects values accepted by more than one branch", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      oneOf: [
        { properties: { left: { type: "string" } }, required: ["left"], type: "object" },
        { properties: { right: { type: "string" } }, required: ["right"], type: "object" },
      ],
    });

    assert.ok(source.includes("z.xor"));
    assert.equal(generatedSchema.safeParse({ left: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ right: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ left: "yes", right: "yes" }).success, false);
    assert.equal(generatedSchema.safeParse({}).success, false);
  });

  void test("oneOf treats integer as overlapping number", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      oneOf: [{ type: "integer" }, { type: "number" }],
    });

    assert.ok(source.includes("z.xor"));
    assert.equal(generatedSchema.safeParse(1).success, false);
    assert.equal(generatedSchema.safeParse(fractionalNumber).success, true);
    assert.equal(generatedSchema.safeParse("1").success, false);
  });

  void test("oneOf does not treat mixed object branches as disjoint", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      oneOf: [
        {
          additionalProperties: false,
          properties: { left: { type: "string" } },
          required: ["left"],
          type: ["object", "null"],
        },
        {
          additionalProperties: false,
          properties: { right: { type: "string" } },
          required: ["right"],
          type: ["object", "null"],
        },
      ],
    });

    assert.ok(source.includes("z.xor"));
    assert.equal(generatedSchema.safeParse(null).success, false);
    assert.equal(generatedSchema.safeParse({ left: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ right: "yes" }).success, true);
  });
});

void describe("JSON Schema composition sibling assertions", () => {
  void test("not false lowers directly to its sibling assertions", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      additionalProperties: false,
      not: false,
      properties: { name: { type: "string" } },
      type: "object",
    });

    assert.ok(!source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse({ name: "example" }).success, true);
    assert.equal(generatedSchema.safeParse({ extra: true, name: "example" }).success, false);
  });

  void test("composition keywords intersect sibling assertions", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      oneOf: [
        { properties: { left: { type: "string" } }, required: ["left"], type: "object" },
        { properties: { right: { type: "string" } }, required: ["right"], type: "object" },
      ],
      properties: { common: { type: "string" } },
      required: ["common"],
      type: "object",
    });

    assert.ok(source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse({ common: "yes", left: "yes" }).success, true);
    assert.equal(generatedSchema.safeParse({ left: "yes" }).success, false);
    assert.equal(
      generatedSchema.safeParse({ common: "yes", left: "yes", right: "yes" }).success,
      false,
    );
  });

  void test("Draft 2020-12 refs intersect sibling assertions", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      $defs: {
        named: { properties: { name: { type: "string" } }, required: ["name"], type: "object" },
      },
      $ref: "#/$defs/named",
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
      type: "object",
    });

    assert.ok(source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse({ enabled: true, name: "example" }).success, true);
    assert.equal(generatedSchema.safeParse({ name: "example" }).success, false);
    assert.equal(generatedSchema.safeParse({ enabled: true }).success, false);
  });

  void test("composition assertions intersect enum siblings", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      enum: [false, "source", "create|source", true],
      oneOf: [{ type: "boolean" }, { type: "string" }],
    });

    assert.ok(source.includes("z.intersection"));
    assert.equal(generatedSchema.safeParse(false).success, true);
    assert.equal(generatedSchema.safeParse("source").success, true);
    assert.equal(generatedSchema.safeParse("unsupported").success, false);
    assert.equal(generatedSchema.safeParse(1).success, false);
  });

  void test("redundant types remain available to lower sibling constraints", async () => {
    const constCase = await compileGeneratedSchema({ const: "xx", minLength: 2, type: "string" });
    const enumCase = await compileGeneratedSchema({
      enum: ["xx", "xy"],
      pattern: "^x",
      type: "string",
    });

    assert.equal(constCase.generatedSchema.safeParse("xx").success, true);
    assert.equal(constCase.generatedSchema.safeParse("x").success, false);
    assert.equal(enumCase.generatedSchema.safeParse("xx").success, true);
    assert.equal(enumCase.generatedSchema.safeParse("unsupported").success, false);
  });
});
