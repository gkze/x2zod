import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createTemporaryDirectory } from "../../../test/native-source-harness";
import type { JsonSchemaValue } from "../src";
import { generateSchemaFixture } from "./schema-fixture-harness";
import { verifySharedRuntimeIsolation } from "./shared-runtime-isolation";

const fixtures: readonly Readonly<{
  name: string;
  schema: JsonSchemaValue;
  accepted: readonly unknown[];
  rejected: readonly unknown[];
}>[] = [
  {
    name: "primitive helpers",
    schema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 2 },
        amount: { type: "number", multipleOf: 0.1 },
        values: { type: "array", uniqueItems: true },
      },
      required: ["name"],
      additionalProperties: false,
    },
    accepted: [{ name: "😀a", amount: 0.3, values: [1, 2] }],
    rejected: [
      { name: "😀" },
      { name: "ab", amount: 0.31 },
      { name: "ab", values: [{ id: 1 }, { id: 1 }] },
    ],
  },
  {
    name: "standalone evaluator",
    schema: {
      type: "object",
      properties: { name: { type: "string" } },
      propertyNames: { minLength: 2 },
      required: ["name"],
      additionalProperties: { type: "string" },
    },
    accepted: [{ name: "works", extra: "yes" }],
    rejected: [{ name: "works", "": "no" }, { name: 1 }],
  },
  {
    name: "unevaluated properties",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      allOf: [{ properties: { name: { type: "string" } }, required: ["name"] }],
      unevaluatedProperties: false,
    },
    accepted: [{ name: "works" }],
    rejected: [{ name: "works", extra: true }, {}],
  },
  {
    name: "dynamic recursive references",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $dynamicAnchor: "node",
      type: "object",
      properties: { name: { type: "string" }, child: { $dynamicRef: "#node" } },
      required: ["name"],
      unevaluatedProperties: false,
    },
    accepted: [{ name: "root", child: { name: "nested" } }],
    rejected: [
      { name: "root", child: { name: 1 } },
      { name: "root", extra: true },
    ],
  },
];

for (const fixture of fixtures)
  void test(`shared runtime preserves declarations and validation for ${fixture.name}`, async () => {
    const generateSource = async (runtimeMode: "inline" | "shared"): Promise<string> => {
      const directory = createTemporaryDirectory({
        prefix: "shared-runtime-",
        rootDirectory: path.join(import.meta.dirname, "../node_modules/.cache"),
      });
      try {
        const validator = await generateSchemaFixture(directory, fixture.schema, {
          runtimeMode,
          consumerSource:
            'import { fixtureSchema } from "./generated";\nexport const name: string = fixtureSchema.parse({ name: "ok" }).name;\n',
        });
        for (const value of fixture.accepted)
          assert.deepEqual(validator.safeParse(value), { success: true, data: value });
        for (const value of fixture.rejected)
          assert.equal(validator.safeParse(value).success, false);
        return await readFile(path.join(directory, "generated.ts"), "utf8");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    };
    const inline = await generateSource("inline");
    const shared = await generateSource("shared");
    await verifySharedRuntimeIsolation(shared, fixture.accepted, fixture.rejected);
    assert.match(shared, /from "@x2zod\/runtime"/u);
    assert.doesNotMatch(inline, /@x2zod\/runtime/u);
    if (shared.includes("@x2zod/runtime/json-schema")) {
      assert.equal(shared.match(/from "@x2zod\/runtime\/json-schema"/gu)?.length, 1);
      assert.doesNotMatch(shared, /const x2zodEvaluateRuntimeNode/u);
      assert.doesNotMatch(shared, /const x2zodEqual =/u);
    }
  });
