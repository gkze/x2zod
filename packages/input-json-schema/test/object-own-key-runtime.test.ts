import assert from "node:assert/strict";
import { test } from "node:test";

import type { JsonObject, JsonValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const sharedDialects = ["draft-7", "draft-2019-09", "draft-2020-12"] as const;
const invalidNumber = 42;

const objectWithOwnPrototype = (value: JsonValue): JsonObject =>
  Object.fromEntries([["__proto__", value]]);

void test("treats an undeclared own __proto__ as an ordinary object key", async () => {
  const acceptedInput = objectWithOwnPrototype("value");
  const invalidCatchallInput = objectWithOwnPrototype(invalidNumber);

  const passthroughSchemas = await Promise.all(
    sharedDialects.map(async (dialect) => {
      const result = await compileGeneratedSchema({ type: "object" }, { dialect });
      return result;
    }),
  );
  for (const passthrough of passthroughSchemas) {
    const passthroughResult = passthrough.generatedSchema.safeParse(acceptedInput);
    assert.equal(passthroughResult.success, true);
    assert.deepEqual(passthroughResult.data, acceptedInput);
    assert.equal(Object.hasOwn(passthroughResult.data, "__proto__"), true);
  }

  const strict = await compileGeneratedSchema({ additionalProperties: false, type: "object" });
  assert.equal(strict.generatedSchema.safeParse(acceptedInput).success, false);

  const catchall = await compileGeneratedSchema({
    additionalProperties: { type: "string" },
    type: "object",
  });
  const catchallResult = catchall.generatedSchema.safeParse(acceptedInput);
  assert.equal(catchallResult.success, true);
  assert.deepEqual(catchallResult.data, acceptedInput);
  assert.equal(catchall.generatedSchema.safeParse(invalidCatchallInput).success, false);

  const propertyNames = await compileGeneratedSchema({ propertyNames: true, type: "object" });
  const propertyNamesResult = propertyNames.generatedSchema.safeParse(acceptedInput);
  assert.equal(propertyNamesResult.success, true);
  assert.deepEqual(propertyNamesResult.data, acceptedInput);
});

void test("preserves own __proto__ through object schemas, references, and transforms", async () => {
  const acceptedInput = objectWithOwnPrototype("value");

  const named = await compileGeneratedSchema({
    propertyNames: { pattern: "^named" },
    type: "object",
  });
  assert.equal(named.generatedSchema.safeParse(acceptedInput).success, false);
  const acceptedName = await compileGeneratedSchema({
    propertyNames: { pattern: "^_" },
    type: "object",
  });
  const acceptedNameResult = acceptedName.generatedSchema.safeParse(acceptedInput);
  assert.equal(acceptedNameResult.success, true);
  assert.deepEqual(acceptedNameResult.data, acceptedInput);
  assert.equal(Object.hasOwn(acceptedNameResult.data, "__proto__"), true);

  const patterned = await compileGeneratedSchema({
    additionalProperties: false,
    patternProperties: { "^__proto__$": { type: "string" } },
    type: "object",
  });
  const patternedResult = patterned.generatedSchema.safeParse(acceptedInput);
  assert.equal(patternedResult.success, true);
  assert.deepEqual(patternedResult.data, acceptedInput);
  assert.equal(
    patterned.generatedSchema.safeParse(objectWithOwnPrototype(invalidNumber)).success,
    false,
  );

  const referenced = await compileGeneratedSchema({
    $defs: { record: { type: "object" } },
    $ref: "#/$defs/record",
  });
  const referencedResult = referenced.generatedSchema.safeParse(acceptedInput);
  assert.equal(referencedResult.success, true);
  assert.deepEqual(referencedResult.data, acceptedInput);

  const composed = await compileGeneratedSchema({
    allOf: [{ type: "object" }, { type: "object" }],
  });
  const composedResult = composed.generatedSchema.safeParse(acceptedInput);
  assert.equal(composedResult.success, true);
  assert.deepEqual(composedResult.data, acceptedInput);

  const transformedInput: JsonObject = Object.fromEntries([
    ["snake_key", "snake-value"],
    ["__proto__", "prototype-value"],
  ]);
  const transformed = await compileGeneratedSchema(
    { properties: { snake_key: { type: "string" } }, required: ["snake_key"], type: "object" },
    {
      transforms: [
        { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
      ],
    },
  );
  const transformedResult = transformed.generatedSchema.safeParse(transformedInput);
  assert.equal(transformedResult.success, true);
  assert.deepEqual(transformedResult.data, {
    snakeKey: "snake-value",
    ["__proto__"]: "prototype-value",
  });
});
