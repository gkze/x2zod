import assert from "node:assert/strict";
import { test } from "node:test";

import { compileGeneratedSchema } from "./generated-schema-harness";

void test("keeps recursive references on an unanchored initial resource", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $id: "http://localhost:4242/draft2019-09/recursiveRef6/base.json",
      $recursiveAnchor: true,
      $schema: "https://json-schema.org/draft/2019-09/schema",
      anyOf: [
        { type: "boolean" },
        {
          additionalProperties: {
            $id: "http://localhost:4242/draft2019-09/recursiveRef6/inner.json",
            anyOf: [
              { type: "integer" },
              { additionalProperties: { $recursiveRef: "#" }, type: "object" },
            ],
          },
          type: "object",
        },
      ],
    },
    { dialect: "draft-2019-09" },
  );

  assert.equal(generatedSchema.safeParse({ foo: true }).success, false);
  assert.equal(generatedSchema.safeParse({ foo: { bar: 1 } }).success, true);
  assert.equal(generatedSchema.safeParse({ foo: { bar: true } }).success, false);
});

void test("ignores unreachable duplicate identifiers when selecting recursive resources", async () => {
  const schema = {
    $defs: {
      tree: {
        $id: "tree",
        $recursiveAnchor: true,
        properties: { child: { $recursiveRef: "#" }, value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
    },
    $id: "https://example.test/strict",
    $recursiveAnchor: true,
    $ref: "tree",
    $schema: "https://json-schema.org/draft/2019-09/schema",
    unevaluatedProperties: false,
  } as const;
  const fixtures = await Promise.all(
    ["a.json", "z.json"].map(async (externalSchemaRelativePath) => {
      const fixture = await compileGeneratedSchema(schema, {
        dialect: "draft-2019-09",
        externalSchema: { $id: schema.$id, type: "number" },
        externalSchemaRelativePath,
      });
      return fixture;
    }),
  );

  for (const { generatedSchema } of fixtures) {
    assert.equal(generatedSchema.safeParse({ value: "a" }).success, true);
    assert.equal(generatedSchema.safeParse({ child: { value: "b" }, value: "a" }).success, true);
    assert.equal(
      generatedSchema.safeParse({ child: { extra: 1, value: "b" }, value: "a" }).success,
      false,
    );
  }
});

void test("resolves recursive references from an unevaluated-items subschema wrapper", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $defs: {
        tree: {
          $id: "./tree",
          $recursiveAnchor: true,
          items: [{ type: "number" }, { $recursiveRef: "#", unevaluatedItems: false }],
          type: "array",
        },
      },
      $id: "https://example.com/unevaluated-items-with-recursive-ref/extended-tree",
      $recursiveAnchor: true,
      $ref: "./tree",
      $schema: "https://json-schema.org/draft/2019-09/schema",
      items: [true, true, { type: "string" }],
    },
    { dialect: "draft-2019-09" },
  );

  assert.equal(generatedSchema.safeParse([1, [2, [], "b"], "a"]).success, true);
  assert.equal(generatedSchema.safeParse([1, [2, [], "b", "too many"], "a"]).success, false);
});

void test("enters a materialized recursive resource through its document pointer", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $id: "https://example.test/materialized-recursive/root",
      $ref: "#/examples/0",
      examples: [
        {
          $id: "node",
          $recursiveAnchor: true,
          properties: { child: { $recursiveRef: "#" }, value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
      ],
    },
    { dialect: "draft-2019-09" },
  );

  assert.equal(generatedSchema.safeParse({ value: "leaf" }).success, true);
  assert.equal(
    generatedSchema.safeParse({ child: { value: "leaf" }, value: "root" }).success,
    true,
  );
  assert.equal(generatedSchema.safeParse({ child: { value: 1 }, value: "root" }).success, false);
});

void test("encodes a materialized recursive resource pointer as a URI fragment", async () => {
  const hostileKey = "a#%/雪";
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $id: "https://example.test/materialized-recursive-encoded/root",
      $ref: "#/examples/a%23%25~1%E9%9B%AA",
      examples: {
        [hostileKey]: {
          $id: "node",
          $recursiveAnchor: true,
          properties: { child: { $recursiveRef: "#" }, value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
      },
    },
    { dialect: "draft-2019-09" },
  );

  assert.equal(
    generatedSchema.safeParse({ child: { value: "leaf" }, value: "root" }).success,
    true,
  );
  assert.equal(generatedSchema.safeParse({ child: { value: 1 }, value: "root" }).success, false);
});
