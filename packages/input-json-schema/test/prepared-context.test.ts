import assert from "node:assert/strict";
import { test } from "node:test";

import type { PreparedInput } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type {
  JsonSchemaInputPluginOptions,
  JsonSchemaPreparedInput,
  JsonSchemaValue,
} from "../src";
import { isJsonObject } from "../src/document";

const rootUri = "https://example.test/first/root";
const targetUri = "https://example.test/first/target";

const prepare = async (
  schema: JsonSchemaValue,
  options: JsonSchemaInputPluginOptions,
): Promise<PreparedInput<JsonSchemaPreparedInput>> => {
  const result = await jsonSchemaInputPlugin.prepare(
    { source: { kind: "uri", uri: rootUri }, text: JSON.stringify(schema) },
    options,
  );
  assert.equal(result.ok, true);
  return result.value;
};

const publicPreparedInput = (
  input: PreparedInput<JsonSchemaPreparedInput>,
): PreparedInput<JsonSchemaPreparedInput> => ({
  ...(input.locations === undefined ? {} : { locations: input.locations }),
  value: {
    applicatorVocabulary: input.value.applicatorVocabulary,
    dialect: input.value.dialect,
    formatAssertionVocabulary: input.value.formatAssertionVocabulary,
    ...(input.value.retrievalUri === undefined ? {} : { retrievalUri: input.value.retrievalUri }),
    schema: input.value.schema,
    source: input.value.source,
    unevaluatedVocabulary: input.value.unevaluatedVocabulary,
    validationVocabulary: input.value.validationVocabulary,
  },
});

const assertMatchesPublicInput = async (
  input: PreparedInput<JsonSchemaPreparedInput>,
  options: JsonSchemaInputPluginOptions,
): Promise<Awaited<ReturnType<typeof jsonSchemaInputPlugin.lower>>> => {
  const expected = await jsonSchemaInputPlugin.lower(publicPreparedInput(input), options);
  const actual = await jsonSchemaInputPlugin.lower(input, options);
  assert.deepEqual(actual, expected);
  return actual;
};

void test("prepared and manually constructed inputs have the same lowering contract", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [targetUri]: { type: "string" },
      "https://example.test/unused": { type: "invalid-unused-type" },
    },
  });
  const prepared = await prepare({ $ref: "target" }, options);

  const lowered = await assertMatchesPublicInput(prepared, options);
  assert.equal(lowered.ok, true);
});

void test("lowering uses a replacement external registry after preparation", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: { [targetUri]: { type: "string" } },
  });
  const prepared = await prepare({ $ref: "target" }, options);
  const updated = { ...options, externalSchemas: { [targetUri]: { type: "number" } } };

  const changed = await assertMatchesPublicInput(prepared, updated);
  const original = await assertMatchesPublicInput(prepared, options);
  assert.equal(changed.ok, true);
  assert.equal(original.ok, true);
});

void test("lowering rebuilds references after an in-place nested schema change", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({});
  const prepared = await prepare(
    { $defs: { target: { $id: "target", type: "string" } }, $ref: "target" },
    options,
  );
  assert.ok(isJsonObject(prepared.value.schema));
  const definitions = prepared.value.schema["$defs"];
  assert.ok(isJsonObject(definitions));
  definitions["target"] = { $id: "other", type: "number" };

  const lowered = await assertMatchesPublicInput(prepared, options);
  assert.equal(lowered.ok, false);
  assert.ok(lowered.diagnostics.some(({ code }) => code === "unresolved_reference"));
});

void test("lowering rebuilds references after an in-place registry schema change", async () => {
  const externalUri = "https://example.test/external/root";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: { [externalUri]: { $defs: { target: { $id: "target", type: "string" } } } },
  });
  const prepared = await prepare({ $ref: "https://example.test/external/target" }, options);
  const external = options.externalSchemas[externalUri];
  assert.ok(isJsonObject(external));
  const definitions = external["$defs"];
  assert.ok(isJsonObject(definitions));
  definitions["target"] = { $id: "other", type: "number" };

  const lowered = await assertMatchesPublicInput(prepared, options);
  assert.equal(lowered.ok, false);
  assert.ok(lowered.diagnostics.some(({ code }) => code === "unresolved_reference"));
});

void test("lowering honors replacement schemas, retrieval URIs, and vocabulary flags", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: {
      [targetUri]: { type: "string" },
      "https://example.test/second/target": { type: "number" },
    },
  });
  const prepared = await prepare({ $ref: "target" }, options);
  const changed = await Promise.all(
    [
      { ...prepared.value, schema: { type: "boolean" } },
      { ...prepared.value, retrievalUri: "https://example.test/second/root" },
    ].map(async (value) => {
      const lowered = await assertMatchesPublicInput({ ...prepared, value }, options);
      return lowered;
    }),
  );
  for (const lowered of changed) assert.equal(lowered.ok, true);

  const typed = await prepare({ type: "string" }, options);
  const changedPolicy = await assertMatchesPublicInput(
    { ...typed, value: { ...typed.value, validationVocabulary: false } },
    options,
  );
  assert.equal(changedPolicy.ok, true);
});

void test("lowering applies current annotation options", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({});
  const prepared = await prepare({ description: "Current description", type: "string" }, options);
  const lowered = await assertMatchesPublicInput(prepared, {
    ...options,
    annotationKeywords: { description: true },
  });
  assert.equal(lowered.ok, true);
});

void test("lowering reports diagnostics at the current source locations", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({ unknownKeywords: "reject" });
  const prepared = await prepare({ type: "string", unknown: true }, options);
  const locations = new Map(
    [...(prepared.locations ?? [])].map(([pointer, span]) => [
      pointer,
      { ...span, file: "relocated.json" },
    ]),
  );

  const lowered = await assertMatchesPublicInput({ ...prepared, locations }, options);
  assert.equal(lowered.ok, false);
  assert.equal(lowered.diagnostics[0].location?.sourceSpan?.file, "relocated.json");
});

void test("no-validator preparation defers invalid references to lowering", async () => {
  const options = jsonSchemaInputPluginOptionsSchema.parse({ validator: "none" });
  const prepared = await prepare({ $ref: "unregistered" }, options);
  const lowered = await assertMatchesPublicInput(prepared, options);

  assert.equal(lowered.ok, false);
  assert.ok(lowered.diagnostics.some(({ code }) => code === "unresolved_reference"));
});
