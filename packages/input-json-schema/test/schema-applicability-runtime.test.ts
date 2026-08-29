import assert from "node:assert/strict";
import { describe, test } from "node:test";

import AjvDraft2020 from "ajv/dist/2020.js";

import type { JsonSchemaValue, JsonValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const valueAboveMaximum = 4;
const inexactDecimalNearMultiple = 0.100_000_000_000_000_02;
const lengthBeyondSafeInteger = 1e100;

type ApplicabilityParityRequest = Readonly<{
  schema: JsonSchemaValue;
  values: readonly JsonValue[];
}>;

type GeneratedSchema = Awaited<ReturnType<typeof compileGeneratedSchema>>["generatedSchema"];
type RuntimeParityRequest = Readonly<{
  generatedSchema: GeneratedSchema;
  validate: (value: unknown) => boolean;
  value: JsonValue;
}>;

const assertRuntimeParity = ({ generatedSchema, validate, value }: RuntimeParityRequest): void => {
  const expectedValue = structuredClone(value);
  const ajvInput = structuredClone(expectedValue);
  const zodInput = structuredClone(expectedValue);
  const ajvAccepted = validate(ajvInput);
  const zodResult = generatedSchema.safeParse(zodInput);
  assert.deepEqual(
    ajvInput,
    expectedValue,
    `Ajv mutated input for ${JSON.stringify(expectedValue)}`,
  );
  assert.deepEqual(
    zodInput,
    expectedValue,
    `generated schema mutated input for ${JSON.stringify(expectedValue)}`,
  );
  assert.equal(
    zodResult.success,
    ajvAccepted,
    `generated schema should match Ajv for ${JSON.stringify(expectedValue)}`,
  );
  if (ajvAccepted && zodResult.success) assert.deepEqual(zodResult.data, expectedValue);
};

const assertAjvParity = async ({ schema, values }: ApplicabilityParityRequest): Promise<void> => {
  const validate = new AjvDraft2020({ logger: false, strict: false }).compile(schema);
  const { generatedSchema } = await compileGeneratedSchema(schema);

  for (const value of values) assertRuntimeParity({ generatedSchema, validate, value });
};

void describe("JSON Schema type-specific keyword applicability", () => {
  void test("detects generated schemas that mutate their input in place", () => {
    const value = { metadata: true };
    const mutatingGeneratedSchema: GeneratedSchema = {
      safeParse: (input) => {
        if (typeof input !== "object" || input === null)
          throw new TypeError("expected object input");
        Reflect.set(input, "mutated", true);
        return { data: input, success: true };
      },
    };

    assert.throws(() => {
      assertRuntimeParity({
        generatedSchema: mutatingGeneratedSchema,
        validate: () => true,
        value,
      });
    }, /mutated input/u);
  });

  void test("preserves non-object applicability for required-only schemas", async () => {
    await assertAjvParity({
      schema: { required: ["metadata"] },
      values: [1, {}, { metadata: true }],
    });
  });

  void test("preserves non-number applicability for untyped numeric bounds", async () => {
    await assertAjvParity({
      schema: { maximum: 3, minimum: 1 },
      values: [0, 2, valueAboveMaximum, "2", true, null, [], {}],
    });
  });

  void test("preserves own __proto__ keys outside numeric applicability", async () => {
    const objectWithOwnPrototype: Record<string, JsonValue> = { ["__proto__"]: null };

    await assertAjvParity({ schema: { minimum: 1 }, values: [objectWithOwnPrototype] });
  });

  void test("preserves non-string applicability for untyped string constraints", async () => {
    await assertAjvParity({
      schema: { maxLength: 3, minLength: 2, pattern: "^[a-z]+$" },
      values: ["a", "ab", "abcd", "12", 2, true, null, [], {}],
    });
  });

  void test("evaluates untyped numeric and string constraints independently", async () => {
    await assertAjvParity({
      schema: { minLength: 2, minimum: 1 },
      values: [0, 2, "a", "ab", true, null, [], {}],
    });
  });

  void test("evaluates untyped assertions independently across JSON value domains", async () => {
    await assertAjvParity({
      schema: { minItems: 1, minLength: 2, minimum: 1, required: ["value"] },
      values: [0, 2, "a", "ab", [], [1], {}, { value: true }, true, null],
    });
  });

  void test("preserves applicability through oneOf refs", async () => {
    await assertAjvParity({
      schema: {
        $defs: { untypedObject: { properties: { value: { type: "string" } } } },
        oneOf: [{ $ref: "#/$defs/untypedObject" }, { type: "number" }],
      },
      values: [1, "value", { value: "ok" }, { value: 1 }],
    });
  });

  void test("preserves applicability in referenced unevaluatedProperties schemas", async () => {
    await assertAjvParity({
      schema: {
        $defs: { untypedObject: { properties: { nested: { type: "string" } } } },
        type: "object",
        unevaluatedProperties: { $ref: "#/$defs/untypedObject" },
      },
      values: [{ value: 42 }, { value: { nested: "ok" } }, { value: { nested: 1 } }],
    });
  });
});

void describe("JSON Schema scalar constraint semantics", () => {
  void test("uses exact decimal multipleOf semantics and ignores non-numbers", async () => {
    const { generatedSchema } = await compileGeneratedSchema({ multipleOf: 0.1 });
    const cases = [
      { accepted: true, value: 0.3 },
      { accepted: false, value: inexactDecimalNearMultiple },
      { accepted: true, value: "0.3" },
    ] as const;

    for (const { accepted, value } of cases) {
      const result = generatedSchema.safeParse(value);
      assert.equal(result.success, accepted, `unexpected result for ${JSON.stringify(value)}`);
      if (accepted && result.success) assert.deepEqual(result.data, value);
    }
  });

  void test("counts string lengths in Unicode code points", async () => {
    await assertAjvParity({
      schema: { maxLength: 2, minLength: 2 },
      values: ["💩", "💩💩", "ab", 2, true, null, [], {}],
    });
  });

  void test("supports string length bounds beyond the safe integer range", async () => {
    await assertAjvParity({
      schema: { minLength: lengthBeyondSafeInteger, type: "string" },
      values: ["", "value"],
    });
    await assertAjvParity({
      schema: { maxLength: lengthBeyondSafeInteger },
      values: ["", "value", 2, true, null, [], {}],
    });
  });
});
