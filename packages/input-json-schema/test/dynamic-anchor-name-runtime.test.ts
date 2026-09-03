import assert from "node:assert/strict";
import { test } from "node:test";

import { compileGeneratedSchema } from "./generated-schema-harness";

void test("resolves a constructor dynamic anchor without consulting Object.prototype", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $dynamicAnchor: "constructor",
    $id: "https://example.com/prototype-safe-constructor",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    properties: { child: { $dynamicRef: "#constructor" }, value: { type: "string" } },
    required: ["value"],
    type: "object",
  });

  assert.equal(
    generatedSchema.safeParse({ child: { value: "nested" }, value: "root" }).success,
    true,
  );
  assert.equal(generatedSchema.safeParse({ child: { value: 42 }, value: "root" }).success, false);
});

void test("falls back to a detached toString dynamic anchor instead of Object.prototype", async () => {
  const externalSchema = {
    $dynamicAnchor: "toString",
    $id: "https://example.com/prototype-safe-external",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "integer",
  } as const;
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $dynamicRef: `${externalSchema.$id}#${externalSchema.$dynamicAnchor}`,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    },
    { externalSchema },
  );

  assert.equal(generatedSchema.safeParse(1).success, true);
  assert.equal(generatedSchema.safeParse("1").success, false);
});

void test("registers a __proto__ dynamic anchor as data instead of mutating the scope", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $dynamicAnchor: "__proto__",
    $id: "https://example.com/prototype-safe-proto",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    items: { $dynamicRef: "#__proto__" },
    type: "array",
  });

  assert.equal(generatedSchema.safeParse([[], [[]]]).success, true);
  assert.equal(generatedSchema.safeParse([1]).success, false);
});

void test("ignores unrelated external dynamic resources deterministically", async () => {
  const schema = {
    $dynamicAnchor: "node",
    $id: "https://example.com/deterministic-dynamic-root",
    properties: { child: { $dynamicRef: "#node" }, value: { type: "string" } },
    required: ["value"],
    type: "object",
  } as const;
  const withoutExternal = await compileGeneratedSchema(schema);
  const withExternal = await compileGeneratedSchema(schema, {
    externalSchema: {
      $dynamicAnchor: "unrelated",
      $id: "https://example.com/unrelated-dynamic-resource",
      type: "string",
    },
  });

  assert.equal(withExternal.source, withoutExternal.source);
});

void test("ignores unevaluated keywords in an unused local definition", async () => {
  const schema = { contains: { type: "integer" }, type: "array" } as const;
  const withoutUnusedDefinition = await compileGeneratedSchema(schema);
  const withUnusedDefinition = await compileGeneratedSchema({
    ...schema,
    $defs: { unused: { unevaluatedProperties: false } },
  });

  assert.equal(withUnusedDefinition.source, withoutUnusedDefinition.source);
});

void test("does not register an unrelated external schema with a duplicate identifier", async () => {
  const schema = {
    $id: "https://example.com/runtime-registration-root",
    contains: { type: "integer" },
    type: "array",
  } as const;
  const withoutExternal = await compileGeneratedSchema(schema);
  const withExternal = await compileGeneratedSchema(schema, {
    externalSchema: { $id: schema.$id, type: "string" },
  });

  assert.equal(withExternal.source, withoutExternal.source);
});

void test("keeps a local dynamic scope isolated from an unrelated duplicate resource", async () => {
  const schema = {
    $dynamicAnchor: "node",
    $id: "urn:example:shared-dynamic-scope",
    properties: { child: { $dynamicRef: "#node" }, value: { type: "string" } },
    required: ["value"],
    type: "object",
  } as const;
  const withoutExternal = await compileGeneratedSchema(schema);
  const withExternal = await compileGeneratedSchema(schema, {
    externalSchema: { $dynamicAnchor: "node", $id: schema.$id, type: "number" },
  });

  assert.equal(withExternal.source, withoutExternal.source);
  assert.equal(
    withExternal.generatedSchema.safeParse({ child: { value: "leaf" }, value: "root" }).success,
    true,
  );
  assert.equal(withExternal.generatedSchema.safeParse({ child: 1, value: "root" }).success, false);
});

void test("preserves a static anchor resource targeted by a dynamic reference", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: {
      bar: { $id: "bar", properties: { baz: { $dynamicRef: "extended#meta" } }, type: "object" },
      extended: {
        $anchor: "meta",
        $id: "extended",
        properties: { bar: { $ref: "bar" } },
        type: "object",
      },
    },
    $dynamicAnchor: "meta",
    $id: "https://test.json-schema.org/relative-dynamic-reference-without-bookend/root",
    $ref: "extended",
    properties: { foo: { const: "pass" } },
    type: "object",
  });

  assert.equal(
    generatedSchema.safeParse({ bar: { baz: { foo: "fail" } }, foo: "pass" }).success,
    true,
  );
});

void test("keeps distinct embedded resource scopes registered for dynamic anchors", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: {
      first: { $defs: { stuff: { $ref: "second#/$defs/stuff" } }, $id: "first" },
      second: {
        $defs: {
          length: { $dynamicAnchor: "length", maxLength: 2 },
          stuff: { $ref: "third#/$defs/stuff" },
        },
        $id: "second",
      },
      third: {
        $defs: {
          length: { $dynamicAnchor: "length", maxLength: 3 },
          stuff: { $dynamicRef: "#length" },
        },
        $id: "third",
      },
    },
    $id: "https://test.json-schema.org/dynamic-ref-avoids-root-of-each-schema/base",
    $ref: "first#/$defs/stuff",
  });

  assert.equal(generatedSchema.safeParse("hi").success, true);
  assert.equal(generatedSchema.safeParse("hey").success, false);
});

void test("enters a materialized dynamic resource through its document pointer", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $id: "https://example.test/materialized-dynamic/root",
    $ref: "#/examples/0",
    examples: [
      {
        $dynamicAnchor: "node",
        $id: "node",
        properties: { child: { $dynamicRef: "#node" }, value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
    ],
  });

  assert.equal(generatedSchema.safeParse({ value: "leaf" }).success, true);
  assert.equal(
    generatedSchema.safeParse({ child: { value: "leaf" }, value: "root" }).success,
    true,
  );
  assert.equal(generatedSchema.safeParse({ child: { value: 1 }, value: "root" }).success, false);
});

void test("encodes a materialized dynamic resource pointer as a URI fragment", async () => {
  const hostileKey = "a#%/雪";
  const { generatedSchema } = await compileGeneratedSchema({
    $id: "https://example.test/materialized-dynamic-encoded/root",
    $ref: "#/examples/a%23%25~1%E9%9B%AA",
    examples: {
      [hostileKey]: {
        $dynamicAnchor: "node",
        $id: "node",
        properties: { child: { $dynamicRef: "#node" }, value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
    },
  });

  assert.equal(
    generatedSchema.safeParse({ child: { value: "leaf" }, value: "root" }).success,
    true,
  );
  assert.equal(generatedSchema.safeParse({ child: { value: 1 }, value: "root" }).success, false);
});
