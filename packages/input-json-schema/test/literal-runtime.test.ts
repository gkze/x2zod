import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jsonSchemaValueSchema } from "../src";
import type { JsonObject, JsonValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertLiteralCases = async (
  schema: Readonly<{ const: JsonValue }>,
  cases: readonly Readonly<{ accepted: boolean; value: JsonValue }>[],
): Promise<void> => {
  const { generatedSchema } = await compileGeneratedSchema(schema);

  for (const { accepted, value } of cases) {
    const input = structuredClone(value);
    const result = generatedSchema.safeParse(input);
    assert.equal(result.success, accepted, `unexpected result for ${JSON.stringify(value)}`);
    assert.deepEqual(input, value);
    if (accepted && result.success) assert.deepEqual(result.data, value);
  }
};

void describe("JSON Schema composite literals", () => {
  void test("lowers an empty array const as an exact tuple", async () => {
    await assertLiteralCases({ const: [] }, [
      { accepted: true, value: [] },
      { accepted: false, value: [null] },
      { accepted: false, value: {} },
    ]);
  });

  void test("lowers nested object and array const values exactly", async () => {
    await assertLiteralCases({ const: { mode: "build", nested: [{ active: true }, null] } }, [
      { accepted: true, value: { nested: [{ active: true }, null], mode: "build" } },
      { accepted: false, value: { mode: "build", nested: [{ active: false }, null] } },
      { accepted: false, value: { mode: "build", nested: [{ active: true }] } },
      { accepted: false, value: { extra: true, mode: "build", nested: [{ active: true }, null] } },
      { accepted: false, value: { mode: "build", nested: [{ active: true, extra: true }, null] } },
    ]);
  });

  void test("lowers heterogeneous composite enum values as literal data", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      enum: [{ $ref: "literal data" }, ["build", 1], null],
    });
    const cases = [
      { accepted: true, value: { $ref: "literal data" } },
      { accepted: true, value: ["build", 1] },
      { accepted: true, value: null },
      { accepted: false, value: { $ref: "#/$defs/schema" } },
      { accepted: false, value: ["build", 2] },
    ] as const;

    for (const { accepted, value } of cases) {
      const result = generatedSchema.safeParse(value);
      assert.equal(result.success, accepted, `unexpected result for ${JSON.stringify(value)}`);
      if (accepted && result.success) assert.deepEqual(result.data, value);
    }
  });

  void test("preserves own __proto__ keys in composite const and enum values", async () => {
    const accepted = { ["__proto__"]: [1] };
    const rejected = { ["__proto__"]: [2] };
    const compiledSchemas = await Promise.all([
      compileGeneratedSchema({ const: accepted }),
      compileGeneratedSchema({ enum: [accepted] }),
    ]);

    for (const { generatedSchema } of compiledSchemas) {
      const result = generatedSchema.safeParse(accepted);

      assert.equal(result.success, true);
      assert.deepEqual(result.data, accepted);
      assert.equal(Object.hasOwn(result.data, "__proto__"), true);
      assert.equal(generatedSchema.safeParse(rejected).success, false);
      assert.equal(generatedSchema.safeParse({}).success, false);
      assert.equal(generatedSchema.safeParse({ ...accepted, extra: true }).success, false);
    }

    const emptyObjectValue = { ["__proto__"]: {} };
    const { generatedSchema } = await compileGeneratedSchema({ const: emptyObjectValue });
    const result = generatedSchema.safeParse(emptyObjectValue);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, emptyObjectValue);
    assert.equal(generatedSchema.safeParse({}).success, false);
  });

  void test("omits redundant composite type siblings", async () => {
    const constCase = await compileGeneratedSchema({ const: { nested: [1] }, type: "object" });
    const enumCase = await compileGeneratedSchema({ enum: [[1], [2]], type: "array" });

    assert.doesNotMatch(constCase.source, /\.intersection\(/u);
    assert.doesNotMatch(enumCase.source, /\.intersection\(/u);
    assert.equal(constCase.generatedSchema.safeParse({ nested: [1] }).success, true);
    assert.equal(enumCase.generatedSchema.safeParse([2]).success, true);
  });
});

void describe("JSON Schema literal traversal boundaries", () => {
  void test("does not normalize Draft 7 keywords inside a contains literal", async () => {
    const literal = { dependencies: { requiredName: { type: "string" } } };
    const { generatedSchema, source } = await compileGeneratedSchema(
      { contains: { const: literal }, type: "array" },
      { dialect: "draft-7" },
    );

    const accepted = [literal];
    assert.deepEqual(generatedSchema.safeParse(accepted), { data: accepted, success: true });
    assert.equal(
      generatedSchema.safeParse([{ dependentSchemas: literal.dependencies }]).success,
      false,
    );
    assert.match(source, /dependencies/u);
  });

  void test("does not treat unevaluated keywords in a literal as schema keywords", async () => {
    const literal = { unevaluatedItems: false, unevaluatedProperties: false };
    const { generatedSchema, source } = await compileGeneratedSchema({ const: literal });

    assert.deepEqual(generatedSchema.safeParse(literal), { data: literal, success: true });
    assert.equal(generatedSchema.safeParse({}).success, false);
    assert.doesNotMatch(source, /x2zodRuntimeProgram/u);
  });

  void test("does not treat dynamic-reference keywords in a literal as schema keywords", async () => {
    const literal = {
      $dynamicAnchor: "node",
      $dynamicRef: "#node",
      $recursiveAnchor: true,
      $recursiveRef: "#",
    };
    const { generatedSchema, source } = await compileGeneratedSchema({ const: literal });

    assert.deepEqual(generatedSchema.safeParse(literal), { data: literal, success: true });
    assert.equal(generatedSchema.safeParse({ $dynamicAnchor: "node" }).success, false);
    assert.doesNotMatch(source, /x2zodRuntimeProgram/u);
  });

  void test("does not apply Draft 7 ref sibling rules inside a literal", async () => {
    const literal = { $ref: "#/definitions/literal", type: "sentinel" };
    const { generatedSchema, source } = await compileGeneratedSchema(
      { const: literal, propertyNames: {} },
      { dialect: "draft-7" },
    );

    assert.deepEqual(generatedSchema.safeParse(literal), { data: literal, success: true });
    assert.equal(generatedSchema.safeParse({ $ref: "#/definitions/literal" }).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });
});

void describe("jsonSchemaValueSchema", () => {
  void test("preserves own __proto__ keys", () => {
    const input: unknown = JSON.parse('{"const":{"nested":[{"__proto__":null}]}}');
    const parsed = jsonSchemaValueSchema.parse(input);

    assert.deepEqual(parsed, input);
    assert.notEqual(typeof parsed, "boolean");
    if (typeof parsed === "boolean") assert.fail("expected an object schema");

    const constValue = parsed["const"];
    assert.ok(isJsonObject(constValue));
    const { nested } = constValue;
    assert.ok(Array.isArray(nested));
    const [specialValue] = nested;
    assert.ok(isJsonObject(specialValue));
    assert.equal(Object.hasOwn(specialValue, "__proto__"), true);
  });

  void test("rejects invalid JSON values stored under own __proto__ keys", () => {
    const invalidValues: readonly unknown[] = [
      undefined,
      Math.max,
      1n,
      Symbol("invalid"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];

    for (const invalidValue of invalidValues) {
      const specialValue = Object.fromEntries([["__proto__", invalidValue]]);
      assert.equal(jsonSchemaValueSchema.safeParse({ const: specialValue }).success, false);
    }

    const cyclicValue: Record<string, unknown> = {};
    cyclicValue["self"] = cyclicValue;
    assert.equal(jsonSchemaValueSchema.safeParse({ const: cyclicValue }).success, false);

    const sparseValue: unknown[] = [];
    sparseValue.length = 1;
    assert.equal(jsonSchemaValueSchema.safeParse({ const: sparseValue }).success, false);
  });

  void test("normalizes inherited object keys and overridden array methods", () => {
    const inheritedSchema: Record<string, unknown> = {};
    Object.setPrototypeOf(inheritedSchema, { type: "string" });
    const parsedSchema = jsonSchemaValueSchema.parse(inheritedSchema);

    assert.notEqual(typeof parsedSchema, "boolean");
    if (typeof parsedSchema === "boolean") assert.fail("expected an object schema");
    assert.equal(Object.hasOwn(parsedSchema, "type"), false);
    const { type } = parsedSchema;
    assert.equal(type, undefined);
    assert.equal(Object.getPrototypeOf(parsedSchema), Object.prototype);
    assert.equal(Object.isFrozen(parsedSchema), true);

    const overriddenArray = [1];
    Object.defineProperty(overriddenArray, "map", { enumerable: true, value: 0 });
    const alternateItems = [2];
    Object.defineProperty(overriddenArray, Symbol.iterator, {
      value: () => alternateItems[Symbol.iterator](),
    });
    const parsedArraySchema = jsonSchemaValueSchema.parse({ const: overriddenArray });
    assert.notEqual(typeof parsedArraySchema, "boolean");
    if (typeof parsedArraySchema === "boolean") assert.fail("expected an object schema");
    const { const: parsedArray } = parsedArraySchema;
    assert.ok(Array.isArray(parsedArray));
    assert.deepEqual(parsedArray, [1]);
    assert.equal(parsedArray.map, Array.prototype.map);
  });

  void test("normalizes shared data and rejects exotic JSON values without throwing", () => {
    const sharedValue = { value: 1 };
    const sharedResult = jsonSchemaValueSchema.safeParse({ const: [sharedValue, sharedValue] });
    assert.equal(sharedResult.success, true);

    const symbolValue: Record<string, unknown> = {};
    Object.defineProperty(symbolValue, Symbol("invalid"), { enumerable: true, value: 1 });
    const throwingValue: Record<string, unknown> = {};
    Object.defineProperty(throwingValue, "value", {
      enumerable: true,
      get: () => {
        throw new Error("unreadable JSON value");
      },
    });

    for (const invalidValue of [symbolValue, throwingValue, new Date(0), new Map()])
      assert.equal(jsonSchemaValueSchema.safeParse({ const: invalidValue }).success, false);
  });
});
