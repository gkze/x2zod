import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import nodePath from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import { compileToZodSource } from "@x2zod/core";

import { createTemporaryDirectory } from "../../../test/native-source-harness";
import {
  jsonSchemaInputPlugin,
  jsonSchemaInputPluginOptionsSchema,
  jsonSchemaValueSchema,
} from "../src";
import { isJsonObject } from "../src/document";
import { validateJsonSchemaMetaSchemaIdentifierOwnership } from "../src/meta-schema-resolution";
import { jsonSchemaDialectMetaSchemas } from "../src/meta-schemas";
import { buildJsonSchemaResourceGraph } from "../src/resource-graph";
import { generateSchemaFixture } from "./schema-fixture-harness";
import { readSchemaStoreFixture } from "./schemastore-fixtures";

const metaSchema = jsonSchemaValueSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(import.meta.resolve("ajv/dist/refs/json-schema-draft-07.json")),
      "utf8",
    ),
  ),
);
const invalidNumericSchema = 42;
const metaSchemaUri = "http://json-schema.org/draft-07/schema";

void test("generates the unmodified Draft 7 meta-schema from a local file and validates schema documents", async () => {
  const directory = createTemporaryDirectory({
    prefix: "meta-schema-e2e-",
    rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
  });
  try {
    const generated = await generateSchemaFixture(directory, metaSchema);
    const ajv = new Ajv({ strict: false, logger: false, validateFormats: false });
    const validate = ajv.getSchema(metaSchemaUri);
    assert.ok(validate !== undefined);
    const valid = [
      true,
      false,
      {},
      metaSchema,
      readSchemaStoreFixture("cargo.json"),
      readSchemaStoreFixture("package.json"),
      { type: "object", properties: { child: { $ref: "#" } }, additionalProperties: false },
      { vendorMetadata: { type: "not-a-schema" } },
    ];
    const invalid = [
      invalidNumericSchema,
      null,
      [],
      { type: "not-a-type" },
      { properties: { bad: { type: 42 } } },
      { required: ["duplicate", "duplicate"] },
      { items: [{ minimum: "zero" }] },
    ];
    for (const [expected, samples] of [
      [true, valid],
      [false, invalid],
    ] as const)
      for (const sample of samples) {
        const original = structuredClone(sample);
        assert.equal(validate(sample), expected, JSON.stringify(validate.errors));
        const parsed = generated.safeParse(sample);
        assert.equal(parsed.success, expected, JSON.stringify(sample));
        assert.deepEqual(sample, original);
        if (parsed.success) assert.deepEqual(parsed.data, original);
      }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

for (const validator of ["ajv", "none"] as const)
  void test(`rejects forged built-in meta-schema content from another location with ${validator}`, async () => {
    const result = await compileToZodSource({
      document: {
        source: { kind: "uri", uri: "https://example.test/local-meta" },
        text: JSON.stringify({ $id: metaSchemaUri, type: "string" }),
      },
      output: { typeName: "Forged" },
      plugin: jsonSchemaInputPlugin,
      pluginOptions: { validator },
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid_schema_document" &&
          diagnostic.message.includes("built-in meta-schema"),
      ),
    );
  });

for (const validator of ["ajv", "none"] as const)
  for (const member of ["valueOf", "toString"] as const)
    void test(`returns an ownership diagnostic for a forged ${member} member with ${validator}`, async () => {
      const options = jsonSchemaInputPluginOptionsSchema.parse({ validator });
      const prepared = await jsonSchemaInputPlugin.prepare(
        {
          source: { kind: "uri", uri: "https://example.test/local-meta" },
          text: JSON.stringify({ $id: metaSchemaUri, [member]: 42, type: "string" }),
        },
        options,
      );
      const result = prepared.ok
        ? await jsonSchemaInputPlugin.lower(prepared.value, options)
        : prepared;
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.diagnostics.map(({ code, message }) => ({ code, message })),
        [
          {
            code: "invalid_schema_document",
            message: `JSON Schema resource identifier conflicts with a built-in meta-schema: ${metaSchemaUri}.`,
          },
        ],
      );
    });

void test("compares authentic meta-schema numbers using JSON numeric equality", () => {
  assert.ok(isJsonObject(metaSchema));
  const { definitions } = metaSchema;
  assert.ok(isJsonObject(definitions));
  const { nonNegativeInteger } = definitions;
  assert.ok(isJsonObject(nonNegativeInteger));
  assert.equal(nonNegativeInteger["minimum"], 0);
  const graph = buildJsonSchemaResourceGraph({
    dialect: "draft-7",
    rootRetrievalUri: "https://example.test/local-meta",
    schema: {
      ...metaSchema,
      definitions: { ...definitions, nonNegativeInteger: { ...nonNegativeInteger, minimum: -0 } },
    },
  });
  assert.equal(graph.ok, true);
  const result = validateJsonSchemaMetaSchemaIdentifierOwnership(
    graph.value.resources,
    graph.value,
  );
  assert.equal(result.ok, true);
});

for (const dialect of ["draft-7", "draft-2020-12"] as const)
  void test(`compiles an authentic ${dialect} meta-schema through an external local resource`, async () => {
    const directory = createTemporaryDirectory({
      prefix: "external-meta-e2e-",
      rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
    });
    try {
      const canonicalUri =
        dialect === "draft-7" ? metaSchemaUri : "https://json-schema.org/draft/2020-12/schema";
      const schema = jsonSchemaDialectMetaSchemas(dialect)[canonicalUri];
      assert.ok(schema !== undefined);
      const generated = await generateSchemaFixture(
        directory,
        { $ref: "https://example.test/local-meta" },
        { dialect, externalSchemas: { "https://example.test/local-meta": schema } },
      );
      assert.equal(
        generated.safeParse({ properties: { child: { type: "string" } } }).success,
        true,
      );
      assert.equal(generated.safeParse({ properties: { child: { type: 42 } } }).success, false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
