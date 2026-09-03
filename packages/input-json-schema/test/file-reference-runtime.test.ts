import assert from "node:assert/strict";
import nodePath from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";

const numericValue = 42;

void test("resolves a relative file source against a file URL external registry", async () => {
  const childRetrievalUri = pathToFileURL(nodePath.resolve("fixtures/child.json")).href;
  const result = await compileToZodSource({
    document: {
      source: { kind: "file", path: "fixtures/root.json" },
      text: JSON.stringify({ $ref: "child.json" }),
      retrievalUri: pathToFileURL(nodePath.resolve("fixtures/root.json")).href,
    },
    output: { typeName: "RelativeFileReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: { [childRetrievalUri]: { type: "string" } },
      validator: "none",
    },
  });

  assert.equal(result.ok, true);
});

void test("preflights a malformed relative external from a file source", async () => {
  const childRetrievalUri = pathToFileURL(nodePath.resolve("fixtures/invalid-child.json")).href;
  const result = await jsonSchemaInputPlugin.prepare(
    {
      source: { kind: "file", path: "fixtures/root.json" },
      text: JSON.stringify({ $ref: "invalid-child.json" }),
      retrievalUri: pathToFileURL(nodePath.resolve("fixtures/root.json")).href,
    },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: { [childRetrievalUri]: { type: "nonsense" } },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "invalid_schema_document"));
});

void test("resolves sibling and nested relative references from a file source", async () => {
  const sibling = await compileGeneratedSchema(
    { $ref: "external-schema.json" },
    { externalSchema: { type: "string" }, externalSchemaRelativePath: "external-schema.json" },
  );
  assert.equal(sibling.generatedSchema.safeParse("value").success, true);
  assert.equal(sibling.generatedSchema.safeParse(numericValue).success, false);

  const nested = await compileGeneratedSchema(
    { $defs: { nested: { $id: "nested/", $ref: "child.json" } }, $ref: "#/$defs/nested" },
    { externalSchema: { type: "number" }, externalSchemaRelativePath: "nested/child.json" },
  );
  assert.equal(nested.generatedSchema.safeParse(numericValue).success, true);
  assert.equal(nested.generatedSchema.safeParse("value").success, false);
});
