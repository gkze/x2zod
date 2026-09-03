import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

void test("uses a URI document source as the root retrieval URI", async () => {
  const result = await compileToZodSource({
    document: {
      source: { kind: "uri", uri: "https://retrieval.example.test/schemas/root.json" },
      text: JSON.stringify({ $ref: "child.json" }),
    },
    output: { typeName: "RetrievedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: { "https://retrieval.example.test/schemas/child.json": { type: "string" } },
      validator: "none",
    },
  });

  assert.equal(result.ok, true);
});

void test("normalizes a trailing fragment in a URI document source", async () => {
  const result = await compileToZodSource({
    document: {
      source: { kind: "uri", uri: "https://retrieval.example.test/schemas/root.json#" },
      text: JSON.stringify({ $ref: "child.json" }),
    },
    output: { typeName: "NormalizedRetrievedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: { "https://retrieval.example.test/schemas/child.json": { type: "string" } },
      validator: "none",
    },
  });

  assert.equal(result.ok, true);
});

void test("rejects a non-empty fragment in a URI document source", async () => {
  const uri = "https://retrieval.example.test/schemas/root.json#target";
  const result = await compileToZodSource({
    document: { source: { kind: "uri", uri }, text: JSON.stringify({ type: "string" }) },
    output: { typeName: "InvalidRetrievedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(
    result.diagnostics[0].message,
    `JSON Schema root retrieval URI must be a fragmentless retrieval URI: ${uri}.`,
  );
});

void test("rejects a normalized URI document source collision", async () => {
  const uri = "https://retrieval.example.test/schemas/root.json";
  const result = await compileToZodSource({
    document: { source: { kind: "uri", uri: `${uri}#` }, text: JSON.stringify({ type: "number" }) },
    output: { typeName: "CollidingRetrievedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { externalSchemas: { [uri]: { type: "string" } }, validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics[0].message,
    `JSON Schema retrieval URI is not unique after normalization: ${uri}.`,
  );
});

void test("rejects a direct same-instance reference cycle", async () => {
  const result = await compileToZodSource({
    document: {
      source: { id: "direct-reference-cycle", kind: "inline" },
      text: JSON.stringify({ $id: "urn:example:self", $ref: "#", type: "string" }),
    },
    output: { typeName: "DirectReferenceCycle" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "cyclic_reference");
});

void test("rejects a mutual same-instance reference cycle", async () => {
  const firstUri = "https://example.test/cycle/first";
  const secondUri = "https://example.test/cycle/second";
  const result = await compileToZodSource({
    document: {
      source: { id: "mutual-reference-cycle", kind: "inline" },
      text: JSON.stringify({ $ref: firstUri }),
    },
    output: { typeName: "MutualReferenceCycle" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: {
        [firstUri]: { $id: firstUri, $ref: secondUri },
        [secondUri]: { $id: secondUri, $ref: firstUri },
      },
      validator: "none",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "cyclic_reference");
});

void test("resolves a named anchor through the public generated runtime", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: { named: { $anchor: "named", type: "string" } },
    $ref: "#named",
  });

  assert.equal(generatedSchema.safeParse("accepted").success, true);
  assert.equal(generatedSchema.safeParse(1).success, false);
});

void test("resolves relative references from the nearest nested resource base", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: {
      entry: {
        $id: "nested/entry",
        properties: { value: { $ref: "target" } },
        required: ["value"],
        type: "object",
      },
      target: { $id: "nested/target", enum: ["accepted"] },
    },
    $id: "https://schemas.example.test/root.json",
    $ref: "nested/entry",
  });

  assert.equal(generatedSchema.safeParse({ value: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ value: "rejected" }).success, false);
});

void test("ignores a Draft 7 sibling identifier while resolving a reference", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $id: "http://localhost:1234/sibling_id/base/",
      allOf: [{ $id: "http://localhost:1234/sibling_id/", $ref: "foo.json" }],
      definitions: {
        baseFoo: { $id: "foo.json", type: "number" },
        foo: { $id: "http://localhost:1234/sibling_id/foo.json", type: "string" },
      },
    },
    { dialect: "draft-7" },
  );

  assert.equal(generatedSchema.safeParse("not the referenced number").success, false);
  assert.equal(generatedSchema.safeParse(1).success, true);
});

void test("omits an ignored Draft 7 root identifier before exact reference compilation", async () => {
  const externalId = "https://example.com/model.schema.json";
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $id: externalId,
      $ref: externalId,
      $schema: "https://json-schema.org/draft-07/schema#",
      type: "string",
    },
    {
      dialect: "draft-7",
      externalSchema: { $id: externalId, contains: { type: "integer" }, type: "array" },
    },
  );

  assert.equal(generatedSchema.safeParse([1]).success, true);
  assert.equal(generatedSchema.safeParse(["1"]).success, false);
});

void test("canonicalizes embedded resources before exact runtime compilation", async () => {
  const schema = {
    $id: "http://example.com/schema-relative-uri-defs1.json",
    properties: {
      foo: {
        $id: "schema-relative-uri-defs2.json",
        $defs: { inner: { properties: { bar: { type: "string" } } } },
        $ref: "#/$defs/inner",
      },
    },
    $ref: "schema-relative-uri-defs2.json",
  } as const;
  const generatedSchemas = await Promise.all(
    (["draft-2019-09", "draft-2020-12"] as const).map(async (dialect) => {
      const fixture = await compileGeneratedSchema(schema, { dialect });
      return fixture;
    }),
  );

  for (const { generatedSchema } of generatedSchemas) {
    assert.equal(generatedSchema.safeParse({ foo: { bar: 1 }, bar: "a" }).success, false);
    assert.equal(generatedSchema.safeParse({ foo: { bar: "a" }, bar: 1 }).success, false);
    assert.equal(generatedSchema.safeParse({ foo: { bar: "a" }, bar: "a" }).success, true);
  }
});

void test("canonicalizes static resources independently of an unrelated dynamic anchor", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: { unused: { $dynamicAnchor: "unused" } },
    $id: "http://example.com/schema-relative-uri-defs1.json",
    properties: {
      foo: {
        $defs: { inner: { properties: { bar: { type: "string" } } } },
        $id: "schema-relative-uri-defs2.json",
        $ref: "#/$defs/inner",
      },
    },
    $ref: "schema-relative-uri-defs2.json",
  });

  assert.equal(generatedSchema.safeParse({ foo: { bar: "a" }, bar: "a" }).success, true);
  assert.equal(generatedSchema.safeParse({ foo: { bar: 1 }, bar: "a" }).success, false);
});

void test("resolves dialect metaschemas as built-in resources", async () => {
  const requests = [
    { dialect: "draft-7", schema: { $ref: "http://json-schema.org/draft-07/schema#" } },
    {
      dialect: "draft-2019-09",
      schema: {
        $ref: "https://json-schema.org/draft/2019-09/schema",
        $schema: "https://json-schema.org/draft/2019-09/schema",
      },
    },
    {
      dialect: "draft-2020-12",
      schema: {
        $ref: "https://json-schema.org/draft/2020-12/schema",
        $schema: "https://json-schema.org/draft/2020-12/schema",
      },
    },
  ] as const;

  const generatedSchemas = await Promise.all(
    requests.map(async ({ dialect, schema }) => {
      const fixture = await compileGeneratedSchema(schema, { dialect });
      return fixture;
    }),
  );
  for (const { generatedSchema } of generatedSchemas) {
    assert.equal(generatedSchema.safeParse({ minLength: 1 }).success, true);
    assert.equal(generatedSchema.safeParse({ minLength: -1 }).success, false);
  }
});

void test("resolves a remote resource by canonical URN instead of its retrieval URI", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    { $ref: "urn:example:model-catalog#model" },
    {
      externalSchema: {
        $anchor: "model",
        $id: "urn:example:model-catalog",
        enum: ["alpha/model", "beta/model"],
      },
    },
  );

  assert.equal(generatedSchema.safeParse("alpha/model").success, true);
  assert.equal(generatedSchema.safeParse("gamma/model").success, false);
});

void test("canonicalizes an exact-runtime reference to an embedded external resource", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    { $ref: "https://schemas.example.test/child" },
    {
      externalSchema: {
        $defs: {
          target: {
            $id: "child",
            additionalProperties: false,
            patternProperties: { "^x": { type: "string" } },
            type: "object",
          },
        },
        $id: "https://schemas.example.test/catalog",
      },
    },
  );

  assert.equal(generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(generatedSchema.safeParse({ other: "rejected" }).success, false);
});

void test("normalizes a trailing-fragment external retrieval key", async () => {
  const uri = "https://example.test/external";
  const schema = { $ref: uri } as const;
  const externalSchema = {
    $id: uri,
    patternProperties: { "^x": { type: "string" } },
    type: "object",
  } as const;
  const bare = await compileGeneratedSchema(schema, { externalSchema, externalSchemaUri: uri });
  const trailingFragment = await compileGeneratedSchema(schema, {
    externalSchema,
    externalSchemaUri: `${uri}#`,
  });

  assert.equal(trailingFragment.source, bare.source);
  for (const { generatedSchema } of [bare, trailingFragment]) {
    assert.equal(generatedSchema.safeParse({ xName: "accepted" }).success, true);
    assert.equal(generatedSchema.safeParse({ xName: 1 }).success, false);
    assert.equal(generatedSchema.safeParse("not-an-object").success, false);
  }
});

void test("preserves a recursive cycle across Draft 2020-12 and Draft 7 resources", async () => {
  const rootUri = "https://example.test/cross-dialect-cycle/root";
  const nodeUri = "https://example.test/cross-dialect-cycle/node";
  const { generatedSchema } = await compileGeneratedSchema(
    { $id: rootUri, $ref: nodeUri, $schema: "https://json-schema.org/draft/2020-12/schema" },
    {
      externalSchema: {
        $id: nodeUri,
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        properties: { next: { $ref: rootUri }, value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
      externalSchemaUri: nodeUri,
    },
  );

  for (const value of [{ value: "leaf" }, { next: { value: "leaf" }, value: "root" }])
    assert.equal(generatedSchema.safeParse(value).success, true);
  assert.equal(generatedSchema.safeParse({ next: { value: 1 }, value: "root" }).success, false);
});

void test("retains a reachable Draft 7 pointer target in an ignored sibling", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    {
      $ref: "#/examples/0",
      $schema: "http://json-schema.org/draft-07/schema#",
      examples: [{ patternProperties: { "^x": { type: "string" } }, type: "object" }],
    },
    { dialect: "draft-7" },
  );

  assert.equal(generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(generatedSchema.safeParse("not-an-object").success, false);
});

void test("retains only the reachable Draft 7 pointer spine in an ignored keyword sibling", async () => {
  const target = { patternProperties: { "^x": { type: "string" } }, type: "object" } as const;
  const schema = {
    $ref: "#/properties/target",
    $schema: "http://json-schema.org/draft-07/schema#",
    properties: { target },
  } as const;
  const withUnusedPeer = await compileGeneratedSchema(
    {
      ...schema,
      properties: { target, unused: { $id: "urn:example:unused-draft7-sibling", type: "integer" } },
    },
    { dialect: "draft-7" },
  );
  const withoutUnusedPeer = await compileGeneratedSchema(schema, { dialect: "draft-7" });

  assert.equal(withUnusedPeer.source, withoutUnusedPeer.source);
  assert.equal(withUnusedPeer.generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(withUnusedPeer.generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(withUnusedPeer.generatedSchema.safeParse("not-an-object").success, false);
});

void test("does not evaluate a retained Draft 7 applicator address spine", async () => {
  const negatedTarget = await compileGeneratedSchema(
    { $ref: "#/not", not: { patternProperties: { "^x": { type: "string" } }, type: "object" } },
    { dialect: "draft-7" },
  );
  const itemTarget = await compileGeneratedSchema(
    { $ref: "#/items", items: { items: { type: "string" }, type: "array" } },
    { dialect: "draft-7" },
  );

  assert.equal(negatedTarget.generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(negatedTarget.generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(negatedTarget.generatedSchema.safeParse("not-an-object").success, false);
  assert.equal(itemTarget.generatedSchema.safeParse(["accepted"]).success, true);
  assert.equal(itemTarget.generatedSchema.safeParse([1]).success, false);
  assert.equal(itemTarget.generatedSchema.safeParse("not-an-array").success, false);
});

void test("ignores Draft 7 reference siblings when selecting a runtime backend", async () => {
  const schema = {
    $ref: "#/definitions/value",
    definitions: { value: { type: "string" } },
  } as const;
  const structural = await compileGeneratedSchema(schema, { dialect: "draft-7" });
  const withIgnoredTrigger = await compileGeneratedSchema(
    { ...schema, propertyNames: { type: "string" } },
    { dialect: "draft-7" },
  );

  assert.equal(withIgnoredTrigger.source, structural.source);
  assert.doesNotMatch(withIgnoredTrigger.source, /x2zodRuntimeProgram/u);
  assert.match(withIgnoredTrigger.source, /z\.string\(\)/u);
});

void test("rejects a reachable descendant in a cross-dialect declaration container", async () => {
  const results = await Promise.all(
    [
      { dialect: "draft-7" as const, keyword: "$defs" },
      { dialect: "draft-2019-09" as const, keyword: "definitions" },
      { dialect: "draft-2020-12" as const, keyword: "definitions" },
    ].map(async ({ dialect, keyword }) => ({
      keyword,
      result: await compileToZodSource({
        document: {
          source: { id: `${dialect}-${keyword}-reference`, kind: "inline" },
          text: JSON.stringify({
            $ref: `#/${keyword}/container/data`,
            [keyword]: {
              container: {
                data: { patternProperties: { "^x": { type: "string" } }, type: "object" },
              },
            },
          }),
        },
        output: { typeName: "CrossDialectReference" },
        plugin: jsonSchemaInputPlugin,
        pluginOptions: { dialect, validator: "none" },
      }),
    })),
  );

  for (const { keyword, result } of results) {
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unknown_keyword" &&
          String(diagnostic.location?.pointer) === `/${keyword}`,
      ),
    );
  }
});

void test("canonicalizes a materialized schema reached through a data container", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: { value: { $id: "nested/value.json", type: "string" } },
    $id: "https://example.test/root",
    $ref: "#/examples/0",
    examples: [
      { $id: "nested/", patternProperties: { "^x": { $ref: "value.json" } }, type: "object" },
    ],
  });

  assert.equal(generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(generatedSchema.safeParse("not-an-object").success, false);
});

void test("encodes a normalized reference pointer as a URI fragment", async () => {
  const hostileKey = "a#%/雪";
  const { generatedSchema } = await compileGeneratedSchema({
    $id: "https://example.test/materialized-reference-encoded/root",
    $ref: "#/examples/a%23%25~1%E9%9B%AA",
    examples: { [hostileKey]: { patternProperties: { "^x": { type: "string" } }, type: "object" } },
  });

  assert.equal(generatedSchema.safeParse({ xName: "accepted" }).success, true);
  assert.equal(generatedSchema.safeParse({ xName: 1 }).success, false);
  assert.equal(generatedSchema.safeParse("not-an-object").success, false);
});

void test("emits executable lazy declarations for nested resource cycles", async () => {
  const { generatedSchema } = await compileGeneratedSchema({
    $defs: {
      node: {
        $anchor: "node",
        $id: "node",
        properties: { next: { $ref: "#node" }, value: { type: "string" } },
        required: ["value"],
        type: "object",
      },
    },
    $id: "https://schemas.example.test/tree/root.json",
    $ref: "node",
  });

  assert.equal(generatedSchema.safeParse({ value: "leaf" }).success, true);
  assert.equal(generatedSchema.safeParse({ next: { value: "leaf" }, value: "root" }).success, true);
  assert.equal(generatedSchema.safeParse({ next: { value: 1 }, value: "root" }).success, false);
});
