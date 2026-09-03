import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileGeneratedSchema } from "./generated-schema-harness";

void describe("JSON Schema uniqueItems generated runtime semantics", () => {
  void test("enforces uniqueItems for non-tuple arrays and preserves accepted values", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      items: {},
      type: "array",
      uniqueItems: true,
    });
    const accepted = [true, 1, false, 0, "1", null];
    const result = generatedSchema.safeParse(accepted);

    assert.equal(result.success, true);
    assert.deepEqual(result.data, accepted);
    assert.equal(generatedSchema.safeParse([1, 1]).success, false);
  });

  void test("compares composite JSON values deeply without object-key-order sensitivity", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      items: {},
      type: "array",
      uniqueItems: true,
    });
    const duplicateObjects = [
      { label: "same", nested: [true, { count: 2 }] },
      { nested: [true, { count: 2 }], label: "same" },
    ];
    const duplicateArrays = [
      [1, { active: true }],
      [1, { active: true }],
    ];

    assert.equal(generatedSchema.safeParse(duplicateObjects).success, false);
    assert.equal(generatedSchema.safeParse(duplicateArrays).success, false);
  });

  void test("applies untyped uniqueItems only to arrays", async () => {
    const { generatedSchema } = await compileGeneratedSchema({ uniqueItems: true });

    assert.equal(generatedSchema.safeParse(["duplicate", "duplicate"]).success, false);
    for (const value of [1, "value", true, null, {}]) {
      const result = generatedSchema.safeParse(value);
      assert.equal(result.success, true);
      assert.deepEqual(result.data, value);
    }
  });

  void test("treats untyped uniqueItems false as a value-preserving no-op", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({ uniqueItems: false });
    const duplicates = [{ nested: [1] }, { nested: [1] }];
    const result = generatedSchema.safeParse(duplicates);

    assert.equal(result.success, true);
    assert.deepEqual(result.data, duplicates);
    assert.match(source, /export const runtimeCaseSchema = z\.unknown\(\);/u);
    assert.doesNotMatch(source, /x2zodApplyRuntimePredicate/u);
    assert.doesNotMatch(source, /x2zodUniqueItems/u);
  });
});
