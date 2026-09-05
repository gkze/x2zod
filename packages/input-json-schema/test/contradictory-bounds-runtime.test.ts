import assert from "node:assert/strict";
import { test } from "node:test";

import { createJsonSchemaAjv } from "../src/ajv-factory";
import type { JsonSchemaValue, JsonValue } from "../src/document";
import { jsonSchemaDialects } from "../src/metadata";
import { compileGeneratedSchema } from "./generated-schema-harness";

const values: readonly JsonValue[] = ["", "x", "xx", [], [1], [1, 2], {}, true, null, 0];
const schemas: readonly JsonSchemaValue[] = [
  { minLength: 2, maxLength: 1 },
  { type: "string", minLength: 2, maxLength: 1 },
  { minItems: 2, maxItems: 1 },
  { type: "array", minItems: 2, maxItems: 1 },
];

for (const dialect of jsonSchemaDialects)
  for (const schema of schemas)
    void test(`preserves ${dialect} contradictory bounds ${JSON.stringify(schema)}`, async () => {
      const ajv = createJsonSchemaAjv(dialect, { strict: false });
      assert.equal(ajv.validateSchema(schema), true);
      const validate = ajv.compile(schema);
      const { generatedSchema } = await compileGeneratedSchema(schema, { dialect });
      for (const value of values) {
        const result = generatedSchema.safeParse(value);
        assert.equal(result.success, validate(value), JSON.stringify({ schema, value }));
        if (result.success) assert.deepEqual(result.data, value);
      }
    });
