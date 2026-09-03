import assert from "node:assert/strict";
import { test } from "node:test";

import { compileGeneratedSchema } from "./generated-schema-harness";

const firstUnsafeInteger = 9_007_199_254_740_992;
const largeInteger = 100_000_000_000_000_000_000;
const invalidInteger = 1.5;
const belowLargeIntegerDelta = 16_384;
const acceptedMultiple = 9_007_199_254_741_000;
const sharedDialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;

void test("accepts every finite integral JavaScript number without safe-integer narrowing", async () => {
  const integerSchemas = await Promise.all(
    sharedDialects.map(async (dialect) => {
      const result = await compileGeneratedSchema({ type: "integer" }, { dialect });
      return result;
    }),
  );
  for (const integer of integerSchemas) {
    for (const value of [firstUnsafeInteger, largeInteger, -largeInteger, Number.MAX_VALUE])
      assert.equal(integer.generatedSchema.safeParse(value).success, true);
    assert.equal(integer.generatedSchema.safeParse(invalidInteger).success, false);
  }

  const union = await compileGeneratedSchema({ type: ["integer", "string"] });
  assert.equal(union.generatedSchema.safeParse(largeInteger).success, true);
  assert.equal(union.generatedSchema.safeParse("value").success, true);
  assert.equal(union.generatedSchema.safeParse(invalidInteger).success, false);

  const bounded = await compileGeneratedSchema({
    maximum: largeInteger,
    minimum: largeInteger,
    type: "integer",
  });
  assert.equal(bounded.generatedSchema.safeParse(largeInteger).success, true);
  assert.equal(
    bounded.generatedSchema.safeParse(largeInteger - belowLargeIntegerDelta).success,
    false,
  );

  const multiple = await compileGeneratedSchema({ multipleOf: 10, type: "integer" });
  assert.equal(multiple.generatedSchema.safeParse(acceptedMultiple).success, true);
  assert.equal(multiple.generatedSchema.safeParse(firstUnsafeInteger).success, false);
});
