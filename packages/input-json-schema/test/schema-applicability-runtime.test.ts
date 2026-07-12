import assert from "node:assert/strict";
import { describe, test } from "node:test";

import AjvDraft2020 from "ajv/dist/2020.js";

import type { JsonSchemaValue, JsonValue } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

type ApplicabilityParityRequest = Readonly<{
  schema: JsonSchemaValue;
  values: readonly JsonValue[];
}>;

const assertAjvParity = async ({ schema, values }: ApplicabilityParityRequest): Promise<void> => {
  const validate = new AjvDraft2020({ logger: false, strict: false }).compile(schema);
  const { generatedSchema } = await compileGeneratedSchema(schema);

  for (const value of values)
    assert.equal(
      generatedSchema.safeParse(value).success,
      validate(value),
      `generated schema should match Ajv for ${JSON.stringify(value)}`,
    );
};

void describe("JSON Schema type-specific keyword applicability", () => {
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
