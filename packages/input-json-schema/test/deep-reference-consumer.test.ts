import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createTemporaryDirectory } from "../../../test/native-source-harness";
import { generateSchemaFixture } from "./schema-fixture-harness";

// A finite chain exercises nested type expansion separately from recursive alias reuse.
const depth = 24;
const definitions = Object.fromEntries(
  Array.from({ length: depth }, (_value, index) => [
    `Level${index.toString()}`,
    {
      type: "object",
      required: ["next"],
      properties: {
        next:
          index === depth - 1
            ? { type: "string", minLength: 1 }
            : { $ref: `#/$defs/Level${(index + 1).toString()}` },
      },
      additionalProperties: false,
    },
  ]),
);
const nested = (leaf: unknown): unknown => {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) value = { next: value };
  return value;
};

void test("deep finite references retain leaf inference and runtime validation", async (context) => {
  const directory = createTemporaryDirectory({
    prefix: "deep-reference-consumer-",
    rootDirectory: path.join(import.meta.dirname, "../node_modules/.cache"),
  });
  try {
    const validator = await generateSchemaFixture(
      directory,
      { $defs: definitions, $ref: "#/$defs/Level0" },
      {
        consumerSource: [
          'import { fixtureSchema } from "./generated";',
          'import type { z } from "zod/v4";',
          "type Leaf<T> = T extends { next: infer Next } ? Leaf<Next> : T;",
          "type Assert<T extends true> = T;",
          "export type InputLeaf = Assert<Leaf<z.input<typeof fixtureSchema>> extends string ? true : false>;",
          "export type OutputLeaf = Assert<Leaf<z.output<typeof fixtureSchema>> extends string ? true : false>;",
          "export type RejectsNumber = Assert<number extends Leaf<z.output<typeof fixtureSchema>> ? false : true>;",
          "export const parse = (value: unknown) => fixtureSchema.parse(value);",
        ].join("\n"),
        onMetrics: (metrics) => {
          context.diagnostic(JSON.stringify({ depth, ...metrics }));
        },
      },
    );
    const value = nested("leaf");
    assert.deepEqual(validator.safeParse(value), { success: true, data: value });
    assert.equal(validator.safeParse(nested(1)).success, false);
    assert.equal(validator.safeParse(nested("")).success, false);
    assert.equal(validator.safeParse(nested({})).success, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
