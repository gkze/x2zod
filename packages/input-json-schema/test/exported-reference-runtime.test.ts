import assert from "node:assert/strict";
import { test } from "node:test";

import type { JsonSchemaValue } from "../src/document";
import { jsonSchemaDialects } from "../src/metadata";
import { compileGeneratedSchema } from "./generated-schema-harness";

const exportOptions = { declarationExportMode: "all", schemaExportName: "thingSchema" } as const;

for (const dialect of jsonSchemaDialects)
  void test(`preserves exact assertions in independently exported ${dialect} references`, async () => {
    const definitions = dialect === "draft-7" ? "definitions" : "$defs";
    const { generatedSchema } = await compileGeneratedSchema(
      {
        [definitions]: { Thing: { type: "object", minProperties: 1 } },
        $ref: `#/${definitions}/Thing`,
      },
      { ...exportOptions, dialect },
    );
    assert.deepEqual(generatedSchema.safeParse({ value: true }), {
      data: { value: true },
      success: true,
    });
    assert.equal(generatedSchema.safeParse({}).success, false);
  });

void test("keeps exported references available after exact runtime fallback", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    { $defs: { Thing: { not: { type: "string" } } }, $ref: "#/$defs/Thing" },
    exportOptions,
  );
  assert.equal(generatedSchema.safeParse("invalid").success, false);
  assert.deepEqual(generatedSchema.safeParse(1), { data: 1, success: true });
});

void test("uses the external resource dialect and base URI for an exported reference", async () => {
  const externalSchema: JsonSchemaValue = {
    $id: "https://example.com/models/thing.json",
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $defs: { value: { type: "string" } },
    type: "object",
    minProperties: 1,
    additionalProperties: { $ref: "#/$defs/value" },
    title: "Thing",
  };
  const { generatedSchema } = await compileGeneratedSchema(
    { $ref: "https://example.com/models/thing.json" },
    {
      ...exportOptions,
      externalSchema,
      externalSchemaUri: "https://example.com/models/thing.json",
    },
  );
  assert.deepEqual(generatedSchema.safeParse({ value: "valid" }), {
    data: { value: "valid" },
    success: true,
  });
  assert.equal(generatedSchema.safeParse({}).success, false);
  assert.equal(generatedSchema.safeParse({ value: 1 }).success, false);
});

void test("keeps inert metadata out of root and independently exported runtime validators", async () => {
  const externalSchemaUri = "https://example.com/inert-keywords/thing";
  const schema = { $id: "https://example.com/inert-keywords/root", $ref: externalSchemaUri };
  const externalSchema = {
    $id: externalSchemaUri,
    title: "Thing",
    type: "object",
    minProperties: 1,
    properties: { xStringMetadata: { type: "string" } },
  };
  const annotatedSchema = { ...schema, xNumberMetadata: 1 };
  const annotatedOptions = {
    declarationExportMode: "all" as const,
    externalSchemaUri,
    externalSchema: {
      ...externalSchema,
      xStringMetadata: "resource documentation",
      properties: { xStringMetadata: { type: "string", xBooleanMetadata: true } },
    },
    inertKeywords: {
      xBooleanMetadata: "boolean",
      xNumberMetadata: "number",
      xStringMetadata: "string",
    } as const,
  };
  const [baseline, root, exported] = await Promise.all([
    compileGeneratedSchema(schema, {
      declarationExportMode: "all",
      externalSchema,
      externalSchemaUri,
    }),
    compileGeneratedSchema(annotatedSchema, annotatedOptions),
    compileGeneratedSchema(annotatedSchema, {
      ...annotatedOptions,
      schemaExportName: "thingSchema",
    }),
  ]);

  assert.equal(root.source, baseline.source);
  assert.equal(exported.source, baseline.source);
  for (const { generatedSchema } of [root, exported]) {
    assert.deepEqual(generatedSchema.safeParse({ xStringMetadata: "instance data" }), {
      data: { xStringMetadata: "instance data" },
      success: true,
    });
    assert.equal(generatedSchema.safeParse({}).success, false);
    assert.equal(generatedSchema.safeParse({ xStringMetadata: 1 }).success, false);
  }
});

void test("starts an exported dynamic schema in its own resource scope", async () => {
  const externalSchema: JsonSchemaValue = {
    $id: "https://example.com/tree",
    $dynamicAnchor: "node",
    type: "object",
    title: "Thing",
    properties: { child: { $dynamicRef: "#node" } },
    minProperties: 1,
  };
  const schema: JsonSchemaValue = {
    $id: "https://example.com/strict-tree",
    $dynamicAnchor: "node",
    $ref: "https://example.com/tree",
    required: ["required_value"],
    properties: { required_value: { type: "string" } },
  };
  const options = {
    declarationExportMode: "all" as const,
    externalSchema,
    externalSchemaUri: "https://example.com/tree",
  };
  const { generatedSchema: root } = await compileGeneratedSchema(schema, options);
  const { generatedSchema: exported } = await compileGeneratedSchema(schema, {
    ...options,
    schemaExportName: "thingSchema",
  });
  const value = { child: { value: true } };
  assert.equal(root.safeParse(value).success, false);
  assert.deepEqual(exported.safeParse(value), { data: value, success: true });
  assert.equal(exported.safeParse({ child: {} }).success, false);
});

void test("keeps transformed internal references in the calling dynamic scope", async () => {
  const externalSchema: JsonSchemaValue = {
    $id: "https://example.com/tree",
    $dynamicAnchor: "node",
    type: "object",
    title: "Thing",
    required: ["base_value"],
    properties: { base_value: { type: "string" }, child: { $dynamicRef: "#node" } },
  };
  const schema: JsonSchemaValue = {
    $id: "https://example.com/root",
    $dynamicAnchor: "node",
    type: "object",
    properties: { user_id: { type: "string" }, tree: { $ref: "https://example.com/tree" } },
    required: ["user_id"],
  };
  const { generatedSchema } = await compileGeneratedSchema(schema, {
    declarationExportMode: "all",
    externalSchema,
    externalSchemaUri: "https://example.com/tree",
    transforms: [
      { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
    ],
  });
  const value = { user_id: "one", tree: { base_value: "two", child: { user_id: "three" } } };
  assert.deepEqual(generatedSchema.safeParse(value), {
    data: { userId: "one", tree: { baseValue: "two", child: { user_id: "three" } } },
    success: true,
  });
  assert.equal(
    generatedSchema.safeParse({ user_id: "one", tree: { base_value: "two", child: {} } }).success,
    false,
  );
});

void test("keeps references back to the root in an exported caller's dynamic scope", async () => {
  const externalSchema: JsonSchemaValue = {
    $id: "https://example.com/tree",
    $dynamicAnchor: "node",
    type: "object",
    title: "Thing",
    required: ["base_value"],
    properties: { base_value: { type: "string" }, child: { $ref: "https://example.com/root" } },
  };
  const schema: JsonSchemaValue = {
    $id: "https://example.com/root",
    $dynamicAnchor: "node",
    type: "object",
    properties: {
      root_value: { type: "string" },
      child: { $dynamicRef: "#node" },
      tree: { $ref: "https://example.com/tree" },
    },
    required: ["root_value"],
  };
  const { generatedSchema } = await compileGeneratedSchema(schema, {
    ...exportOptions,
    externalSchema,
    externalSchemaUri: "https://example.com/tree",
    transforms: [
      { kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } },
    ],
  });
  assert.deepEqual(
    generatedSchema.safeParse({
      base_value: "one",
      child: { root_value: "two", child: { base_value: "three" } },
    }),
    {
      data: { baseValue: "one", child: { rootValue: "two", child: { base_value: "three" } } },
      success: true,
    },
  );
});
