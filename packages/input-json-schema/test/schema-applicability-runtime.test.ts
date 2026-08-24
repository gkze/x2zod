import assert from "node:assert/strict";
import { describe, test } from "node:test";

import AjvDraft2020 from "ajv/dist/2020.js";

import type { JsonSchemaValue, JsonValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

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
