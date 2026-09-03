import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonObject } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const acceptedTail = 3;
const invalidNestedValue = 42;
const overflowingInput = 1e308;
const conditionalBranchKey = ["th", "en"].join("");
const adversarialDescriptionFillerLength = 40_000;
const adversarialDescriptionStatementCount = 10_000;
const patternPropertiesCount = 600;
const largePatternPropertyIndex = patternPropertiesCount - 1;
const largePatternPropertyInvalidValue = 599;
const hostileJsonPropertyNames = ["constructor", "valueOf", "toString", "__proto__"] as const;
const hostileJsonObject = (property: string, nested: boolean): JsonObject => ({
  [property]: { nested },
});
const adversarialDescription = [
  "function validate7(data) {",
  "x".repeat(adversarialDescriptionFillerLength),
  " if (foo) {",
  Array.from(
    { length: adversarialDescriptionStatementCount },
    (_unused, index) => `x${index.toString()}++;`,
  ).join(""),
  "}",
  "}",
].join("");
const largePatternProperties = Object.fromEntries(
  Array.from({ length: patternPropertiesCount }, (_unused, index) => [
    `^p${index.toString()}$`,
    { minLength: 1, type: "string" },
  ]),
);

void describe("generated exact JSON Schema backend", () => {
  void test("compiles runtime-only keywords through the public plugin API", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "standalone-backend", kind: "inline" },
        text: JSON.stringify({ contains: { type: "integer" }, type: "array" }),
      },
      output: { typeName: "ContainsArray" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, true);
  });

  void test("preserves a reachable embedded Draft 7 resource", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {
        embedded: {
          $id: "embedded",
          $schema: "http://json-schema.org/draft-07/schema#",
          dependencies: { requiredName: ["name"] },
          type: "object",
        },
      },
      $ref: "embedded",
    });

    assert.equal(generatedSchema.safeParse({ requiredName: true, name: "ok" }).success, true);
    assert.equal(generatedSchema.safeParse({ requiredName: true }).success, false);
  });

  void test("retains Draft 7 dependencies for a same-dialect runtime", async () => {
    const { generatedSchema } = await compileGeneratedSchema(
      { dependencies: { requiredName: { required: ["name"] } }, type: "object" },
      { dialect: "draft-7" },
    );

    assert.equal(generatedSchema.safeParse({ requiredName: true, name: "ok" }).success, true);
    assert.equal(generatedSchema.safeParse({ requiredName: true }).success, false);
  });

  void test("ignores unrelated external-resource dialects during exact compilation", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "mixed-external-dialects", kind: "inline" },
        text: JSON.stringify({
          $schema: "https://json-schema.org/draft/2019-09/schema",
          contains: { type: "integer" },
          type: "array",
        }),
      },
      output: { typeName: "MixedExternalDialects" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: {
        dialect: "draft-2019-09",
        externalSchemas: {
          "https://schemas.example.test/unrelated-2020.json": {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "string",
          },
        },
        validator: "none",
      },
    });

    assert.equal(result.ok, true);
  });

  void test("ignores an unused external whose retrieval URI matches the root identifier", async () => {
    const rootUri = "https://example.com/runtime-registration-root";
    const schema = { $id: rootUri, contains: { type: "integer" }, type: "array" } as const;
    const baseline = await compileGeneratedSchema(schema);
    const withUnusedExternal = await compileGeneratedSchema(schema, {
      externalSchema: { $id: "https://example.com/unrelated", type: "string" },
      externalSchemaUri: rootUri,
    });

    assert.equal(withUnusedExternal.source, baseline.source);
    assert.equal(withUnusedExternal.generatedSchema.safeParse([1]).success, true);
    assert.equal(withUnusedExternal.generatedSchema.safeParse(["not-an-integer"]).success, false);
  });

  void test("does not treat validator-like text in schema descriptions as generated validators", async () => {
    const result = await compileToZodSource({
      document: {
        source: { id: "validator-like-description", kind: "inline" },
        text: JSON.stringify({
          contains: { type: "integer" },
          description: adversarialDescription,
          type: "array",
        }),
      },
      output: { typeName: "ValidatorLikeDescription" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator: "none" },
    });

    assert.equal(result.ok, true);
  });
});

void test("chunks a large patternProperties validator through the public path", async () => {
  const { generatedSchema, source } = await compileGeneratedSchema({
    patternProperties: largePatternProperties,
    type: "object",
  });

  assert.match(source, /const x2zodvalidate\d+Chunk\w*\s*(?::\s*[^=]+)?=\s*\(\) =>/u);
  assert.equal(
    generatedSchema.safeParse({ [`p${largePatternPropertyIndex.toString()}`]: "accepted" }).success,
    true,
  );
  assert.equal(
    generatedSchema.safeParse({
      [`p${largePatternPropertyIndex.toString()}`]: largePatternPropertyInvalidValue,
    }).success,
    false,
  );
});

void describe("generated exact JSON Schema backend identity", () => {
  void test("compares hostile nested object properties by JSON value for const and enum", async () => {
    const fixtures = hostileJsonPropertyNames.flatMap((property) => {
      const value = hostileJsonObject(property, true);
      return [{ const: value }, { enum: [value] }].map(async (constraint) => ({
        compiled: await compileGeneratedSchema({ ...constraint, propertyNames: true }),
        value,
      }));
    });

    for (const { compiled, value } of await Promise.all(fixtures))
      assert.deepEqual(compiled.generatedSchema.safeParse(value), { data: value, success: true });
  });

  void test("compares hostile nested object properties by JSON value for uniqueItems", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      contains: true,
      type: "array",
      uniqueItems: true,
    });

    for (const property of hostileJsonPropertyNames) {
      const first = hostileJsonObject(property, true);
      const second = structuredClone(first);
      const distinct = hostileJsonObject(property, false);

      assert.equal(generatedSchema.safeParse([first, second]).success, false);
      assert.deepEqual(generatedSchema.safeParse([first, distinct]), {
        data: [first, distinct],
        success: true,
      });
    }
  });

  void test("preserves contains semantics and successful input identity", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      contains: { const: 2 },
      type: "array",
    });
    const accepted = [1, 2, acceptedTail];

    assert.equal(generatedSchema.safeParse(accepted).success, true);
    assert.deepEqual(generatedSchema.safeParse(accepted), { data: accepted, success: true });
    assert.equal(generatedSchema.safeParse([1, acceptedTail]).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });

  void test("uses an identity-preserving projection for propertyNames", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      propertyNames: { const: "foo" },
    });
    const accepted = { foo: 1 };

    assert.deepEqual(generatedSchema.safeParse(accepted), { data: accepted, success: true });
    assert.deepEqual(generatedSchema.safeParse({}), { data: {}, success: true });
    assert.equal(generatedSchema.safeParse({ bar: 1 }).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });

  void test("uses own-property semantics for prototype-sensitive object keys", async () => {
    const propertiesSchema = await compileGeneratedSchema({
      properties: {
        ["__proto__"]: { type: "number" },
        constructor: { type: "number" },
        toString: { properties: { length: { type: "string" } } },
      },
    });
    const requiredSchema = await compileGeneratedSchema({
      required: ["__proto__", "toString", "constructor"],
    });
    const allPresent = JSON.parse(
      '{"__proto__":12,"toString":{"length":"foo"},"constructor":37}',
    ) as unknown;

    assert.deepEqual(propertiesSchema.generatedSchema.safeParse({}), { data: {}, success: true });
    assert.deepEqual(propertiesSchema.generatedSchema.safeParse(allPresent), {
      data: allPresent,
      success: true,
    });
    assert.equal(
      propertiesSchema.generatedSchema.safeParse(JSON.parse('{"__proto__":"wrong"}') as unknown)
        .success,
      false,
    );
    assert.equal(requiredSchema.generatedSchema.safeParse({}).success, false);
    assert.deepEqual(requiredSchema.generatedSchema.safeParse(allPresent), {
      data: allPresent,
      success: true,
    });
    assert.match(propertiesSchema.source, /x2zodPreserveObjectInput/u);
    assert.match(requiredSchema.source, /x2zodPreserveObjectInput/u);
  });
});

void describe("generated exact JSON Schema backend annotations", () => {
  void test("collects evaluated item annotations from every successful anyOf branch", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      anyOf: [{ items: { type: "string" } }, true],
      unevaluatedItems: { type: "boolean" },
    });
    const booleans = [true, false];
    const strings = ["yes", "no"];

    assert.deepEqual(generatedSchema.safeParse(booleans), { data: booleans, success: true });
    assert.deepEqual(generatedSchema.safeParse(strings), { data: strings, success: true });
    assert.equal(generatedSchema.safeParse(["yes", false]).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });

  void test("collects evaluated property annotations from the selected conditional branch", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      else: { properties: { baz: { type: "string" } }, required: ["baz"] },
      if: { properties: { foo: { const: "then" } }, required: ["foo"] },
      unevaluatedProperties: false,
    });
    const thenValue = { foo: "then" };
    const elseValue = { baz: "baz" };

    assert.deepEqual(generatedSchema.safeParse(thenValue), { data: thenValue, success: true });
    assert.deepEqual(generatedSchema.safeParse(elseValue), { data: elseValue, success: true });
    assert.equal(generatedSchema.safeParse({ bar: "bar", foo: "then" }).success, false);
    assert.equal(generatedSchema.safeParse({ baz: "baz", foo: "else" }).success, false);
  });

  void test("preserves hoisted validators used by Ajv reference wrappers", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      $defs: { record: { patternProperties: { "^x": { type: "string" } }, type: "object" } },
      $ref: "#/$defs/record",
    });

    assert.equal(generatedSchema.safeParse({ xValue: "accepted" }).success, true);
    assert.equal(generatedSchema.safeParse({ xValue: 1 }).success, false);
    assert.doesNotMatch(source, /const validate\d+\s*:\s*any\s*=\s*function/u);
  });
});

void describe("generated exact JSON Schema backend references", () => {
  void test("resolves a detached dynamic anchor through a dynamic reference", async () => {
    const { generatedSchema } = await compileGeneratedSchema(
      { $ref: "https://example.com/model.schema.json#/$defs/foo" },
      {
        externalSchema: {
          $id: "https://example.com/model.schema.json",
          $defs: {
            detached: { $dynamicAnchor: "detached", type: "integer" },
            foo: { $dynamicRef: "#detached" },
          },
        },
      },
    );

    assert.equal(generatedSchema.safeParse(1).success, true);
    assert.equal(generatedSchema.safeParse("a").success, false);
  });

  void test("resolves a dynamic reference through the active resource scope", async () => {
    const { generatedSchema } = await compileGeneratedSchema(
      {
        $defs: {
          itemType: { $dynamicAnchor: "items", type: "string" },
          list: {
            $defs: { items: { $dynamicAnchor: "items" } },
            $id: "list",
            items: { $dynamicRef: "#items" },
            type: "array",
          },
          unused: { $id: "unused", $schema: "https://example.com/model.schema.json", minimum: 10 },
        },
        $id: "https://test.json-schema.org/typical-dynamic-resolution/root",
        $ref: "list",
      },
      {
        externalSchema: {
          $id: "https://example.com/model.schema.json",
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $vocabulary: {
            "https://json-schema.org/draft/2020-12/vocab/core": true,
            "https://json-schema.org/draft/2020-12/vocab/applicator": true,
          },
        },
      },
    );

    assert.equal(generatedSchema.safeParse(["foo", "bar"]).success, true);
    assert.equal(generatedSchema.safeParse(["foo", invalidNestedValue]).success, false);
  });

  void test("removes a dynamic resource scope after its evaluation completes", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      $defs: {
        start: { $dynamicRef: "inner_scope#thingy", $id: "start" },
        thingy: { $dynamicAnchor: "thingy", $id: "inner_scope", type: "string" },
      },
      $id: "https://test.json-schema.org/dynamic-ref-leaving-dynamic-scope/main",
      if: { $defs: { thingy: { $dynamicAnchor: "thingy", type: "number" } }, $id: "first_scope" },
      ...Object.fromEntries([
        [
          conditionalBranchKey,
          {
            $defs: { thingy: { $dynamicAnchor: "thingy", type: "null" } },
            $id: "second_scope",
            $ref: "start",
          },
        ],
      ]),
    });

    assert.equal(generatedSchema.safeParse("a string").success, false);
    assert.equal(generatedSchema.safeParse(invalidNestedValue).success, false);
    assert.equal(generatedSchema.safeParse(null).success, true);
  });

  void test("uses ordinary reference semantics for dynamic JSON Pointer references", async () => {
    const { generatedSchema } = await compileGeneratedSchema({
      $defs: { falseSchema: false, trueSchema: true },
      properties: {
        falseValue: { $dynamicRef: "#/$defs/falseSchema" },
        trueValue: { $dynamicRef: "#/$defs/trueSchema" },
      },
    });

    assert.equal(generatedSchema.safeParse({ trueValue: 1 }).success, true);
    assert.equal(generatedSchema.safeParse({ falseValue: 1 }).success, false);
  });
});

void describe("generated exact JSON Schema backend arrays", () => {
  void test("does not change a root validator when unrelated runtime resources are registered", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema(false, {
      externalSchema: {
        $id: "https://example.com/model.schema.json",
        contains: { type: "integer" },
        type: "array",
      },
    });

    assert.equal(generatedSchema.safeParse("rejected").success, false);
    assert.doesNotMatch(source, /x2zodRuntimeProgram/u);
  });

  void test("rejects finite multiples whose quotient overflows", async () => {
    const { generatedSchema } = await compileGeneratedSchema(
      { multipleOf: 0.123_456_789, type: "integer" },
      {
        externalSchema: {
          $id: "https://example.com/model.schema.json",
          contains: { type: "integer" },
          type: "array",
        },
      },
    );

    assert.equal(generatedSchema.safeParse(overflowingInput).success, false);
  });

  void test("preserves flexible 2020-12 prefixItems and trailing items semantics", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      items: false,
      prefixItems: [{ type: "string" }, { type: "integer" }],
      type: "array",
    });

    assert.equal(generatedSchema.safeParse([]).success, true);
    assert.equal(generatedSchema.safeParse(["left"]).success, true);
    assert.equal(generatedSchema.safeParse(["left", 2]).success, true);
    assert.equal(generatedSchema.safeParse(["left", "wrong"]).success, false);
    assert.equal(generatedSchema.safeParse(["left", 2, true]).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });

  for (const dialect of ["draft-7", "draft-2019-09"] as const)
    void test(`preserves ${dialect} tuple items and additionalItems semantics`, async () => {
      const { generatedSchema, source } = await compileGeneratedSchema(
        { additionalItems: false, items: [{ type: "string" }, { type: "integer" }], type: "array" },
        { dialect },
      );

      assert.equal(generatedSchema.safeParse([]).success, true);
      assert.equal(generatedSchema.safeParse(["left", 2]).success, true);
      assert.equal(generatedSchema.safeParse(["left", "wrong"]).success, false);
      assert.equal(generatedSchema.safeParse(["left", 2, true]).success, false);
      assert.match(source, /x2zodRuntimeProgram/u);
    });

  void test("preserves minContains and maxContains cardinality", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      contains: { const: 1 },
      maxContains: 2,
      minContains: 2,
      type: "array",
    });

    assert.equal(generatedSchema.safeParse([1, 1, 2]).success, true);
    assert.equal(generatedSchema.safeParse([1, 2]).success, false);
    assert.equal(generatedSchema.safeParse([1, 1, 1]).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });

  void test("preserves uniqueItems beside flexible prefixItems", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      prefixItems: [{ type: "boolean" }, { type: "boolean" }],
      type: "array",
      uniqueItems: true,
    });

    assert.equal(generatedSchema.safeParse([true, false]).success, true);
    assert.equal(generatedSchema.safeParse([true, true]).success, false);
    assert.match(source, /x2zodRuntimeProgram/u);
  });
});
