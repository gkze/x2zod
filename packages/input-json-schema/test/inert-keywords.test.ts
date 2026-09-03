import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";
import type { CompileToZodSourceResult, ts } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";

const inertKeywords = {
  xBooleanMetadata: "boolean",
  xNullMetadata: "null",
  xNumberMetadata: "number",
  xStringMetadata: "string",
} as const;

const compileSchema = async (
  schema: JsonSchemaValue,
  pluginOptions: JsonSchemaInputPluginOptionsInput = {},
): Promise<CompileToZodSourceResult> => {
  const result = await compileToZodSource({
    document: { source: { id: "inert-keywords", kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "InertKeywordSchema" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions,
  });
  return result;
};

const expectSourceFile = (result: CompileToZodSourceResult): ts.SourceFile => {
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.value.sourceFile;
};

const diagnosticPointers = (
  result: CompileToZodSourceResult,
  code: string,
): readonly (string | undefined)[] =>
  (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.code === code)
    .map((diagnostic) => diagnostic.location?.pointer)
    .toSorted((left, right) => (left ?? "").localeCompare(right ?? ""));

void test("inert keywords default to an empty map and keep unknown keywords strict", async () => {
  assert.deepEqual(jsonSchemaInputPluginOptionsSchema.parse({}).inertKeywords, {});

  const results = await Promise.all(
    [{}, { validator: "none" as const }].map(async (pluginOptions) => {
      const result = await compileSchema(
        { type: "string", xStringMetadata: "documentation" },
        pluginOptions,
      );
      return result;
    }),
  );

  for (const result of results) {
    assert.equal(result.ok, false);
    assert.deepEqual(diagnosticPointers(result, "unknown_keyword"), ["/xStringMetadata"]);
  }
});

void test("inert keywords accept configured primitives and report each occurrence", async () => {
  const schema = {
    type: "object",
    xBooleanMetadata: true,
    xNullMetadata: null,
    xNumberMetadata: 1.5,
    xStringMetadata: "documentation",
  } as const;
  const expectedPointers = [
    "/xBooleanMetadata",
    "/xNullMetadata",
    "/xNumberMetadata",
    "/xStringMetadata",
  ];

  const results = await Promise.all(
    (["ajv", "none"] as const).map(async (validator) => {
      const result = await compileSchema(schema, { inertKeywords, validator });
      return result;
    }),
  );
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.deepEqual(diagnosticPointers(result, "json-schema/ignored-keyword"), expectedPointers);
    assert.ok(
      result.diagnostics?.every(
        (diagnostic) =>
          diagnostic.code !== "json-schema/ignored-keyword" || diagnostic.severity === "warning",
      ) === true,
    );
  }
});

void test("inert keywords reject values with the wrong primitive type", async () => {
  const cases = [
    { expectedType: "boolean", keyword: "xBooleanMetadata", value: "true" },
    { expectedType: "null", keyword: "xNullMetadata", value: false },
    { expectedType: "number", keyword: "xNumberMetadata", value: null },
    { expectedType: "string", keyword: "xStringMetadata", value: 1 },
    { expectedType: "string", keyword: "xStringMetadata", value: [] },
    { expectedType: "string", keyword: "xStringMetadata", value: {} },
  ] as const;

  const outcomes = await Promise.all(
    (["ajv", "none"] as const).flatMap((validator) =>
      cases.map(async ({ expectedType, keyword, value }) => ({
        keyword,
        result: await compileSchema(
          { [keyword]: value, type: "string" },
          { inertKeywords: { [keyword]: expectedType }, validator },
        ),
        validator,
      })),
    ),
  );

  for (const { keyword, result, validator } of outcomes) {
    assert.equal(result.ok, false, `${keyword} with ${validator}`);
    assert.deepEqual(
      diagnosticPointers(result, "invalid_schema_document"),
      [`/${keyword}`],
      `${keyword} with ${validator}`,
    );
    assert.deepEqual(diagnosticPointers(result, "unknown_keyword"), []);
  }
});

void test("inert keywords report nested and reachable external occurrences once", async () => {
  const externalSchemaUri = "https://example.test/inert-keywords/external";
  const result = await compileSchema(
    {
      allOf: [
        { minLength: 1, type: "string", xStringMetadata: "nested documentation" },
        { $ref: externalSchemaUri },
      ],
    },
    {
      externalSchemas: {
        [externalSchemaUri]: { type: "string", xBooleanMetadata: true },
        "https://example.test/inert-keywords/unused": {
          type: "string",
          xNumberMetadata: "invalid but unreachable",
        },
      },
      inertKeywords,
      validator: "none",
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(diagnosticPointers(result, "json-schema/ignored-keyword"), [
    "/allOf/0/xStringMetadata",
    "/xBooleanMetadata",
  ]);
});

void test("inert keyword configuration rejects standard and dollar-reserved names", () => {
  for (const keyword of ["", "type", "$vendorMetadata"])
    assert.equal(
      jsonSchemaInputPluginOptionsSchema.safeParse({ inertKeywords: { [keyword]: "string" } })
        .success,
      false,
      keyword,
    );

  assert.equal(
    jsonSchemaInputPluginOptionsSchema.safeParse({
      dialect: "draft-7",
      inertKeywords: { prefixItems: "string" },
    }).success,
    false,
    "prefixItems remains reserved when inactive in Draft 7",
  );
});

void test("configured inert keyword rules compose with and take precedence over profiles", async () => {
  const [additive, mismatch] = await Promise.all([
    compileSchema(
      { tsType: "string", type: "string", xBooleanMetadata: true },
      {
        inertKeywords: { xBooleanMetadata: "boolean" },
        sourceProfile: "schemastore",
        validator: "none",
      },
    ),
    compileSchema(
      { tsType: true, type: "string" },
      { inertKeywords: { tsType: "string" }, sourceProfile: "schemastore", validator: "none" },
    ),
  ]);

  assert.equal(additive.ok, true);
  assert.deepEqual(diagnosticPointers(additive, "json-schema/ignored-keyword"), [
    "/tsType",
    "/xBooleanMetadata",
  ]);
  assert.equal(mismatch.ok, false);
  assert.deepEqual(diagnosticPointers(mismatch, "invalid_schema_document"), ["/tsType"]);
  assert.deepEqual(diagnosticPointers(mismatch, "json-schema/ignored-keyword"), []);
});

void test("inert keywords do not change generated source for composition siblings", async () => {
  const schema = { anyOf: [{ type: "string" }, { type: "number" }] } as const;
  const [baseline, annotated] = await Promise.all([
    compileSchema(schema, { validator: "none" }),
    compileSchema(
      { ...schema, xStringMetadata: "composition documentation" },
      { inertKeywords, validator: "none" },
    ),
  ]);

  assert.deepEqual(expectSourceFile(annotated), expectSourceFile(baseline));
  assert.deepEqual(diagnosticPointers(annotated, "json-schema/ignored-keyword"), [
    "/xStringMetadata",
  ]);
});

void test("inert keywords do not strip matching names inside instance values", async () => {
  const instance = { xStringMetadata: "instance data" } as const;
  const [baseline, annotated] = await Promise.all([
    compileSchema(
      { const: instance, propertyNames: {} },
      { dialect: "draft-7", validator: "none" },
    ),
    compileSchema(
      { const: instance, propertyNames: {}, xStringMetadata: "schema metadata" },
      { dialect: "draft-7", inertKeywords, validator: "none" },
    ),
  ]);

  assert.deepEqual(expectSourceFile(annotated), expectSourceFile(baseline));
  assert.deepEqual(diagnosticPointers(annotated, "json-schema/ignored-keyword"), [
    "/xStringMetadata",
  ]);
});
