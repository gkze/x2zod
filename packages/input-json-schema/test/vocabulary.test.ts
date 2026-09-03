import assert from "node:assert/strict";
import { test } from "node:test";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";
import {
  customMetaschema,
  expectOk,
  optionsFor,
  prepareSchema,
  stockSchemaUri,
} from "./vocabulary-test-support";

void test("does not let an external identifier override a recognized stock dialect", async () => {
  const stockUri = stockSchemaUri("draft-2020-12");
  const numericValue = 42;
  const externalSchema = {
    $id: stockUri,
    $schema: stockUri,
    $vocabulary: {
      "https://json-schema.org/draft/2020-12/vocab/applicator": true,
      "https://json-schema.org/draft/2020-12/vocab/core": true,
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
    },
  };
  const prepared = await prepareSchema(
    { $schema: stockUri, type: "string" },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: { "https://example.test/unreferenced.json": externalSchema },
    }),
    "stock.json",
  );
  assert.equal(prepared.ok, true);

  const { generatedSchema } = await compileGeneratedSchema(
    { $schema: stockUri, type: "string" },
    { externalSchema },
  );

  assert.equal(generatedSchema.safeParse("value").success, true);
  assert.equal(generatedSchema.safeParse(numericValue).success, false);
});

void test("rejects external retrieval keys reserved for stock metaschemas", async () => {
  const stockUri = stockSchemaUri("draft-2020-12");
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: { [`${stockUri}#`]: false },
    validator: "none",
  });
  const prepared = expectOk(
    await prepareSchema({ $ref: stockUri, $schema: stockUri }, options, "stock.json"),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, false);
  assert.equal(lowered.diagnostics[0].code, "invalid_schema_document");
});

void test("resolves a custom metaschema by exact retrieval URI independent of registry order", async () => {
  const uri = "https://example.test/meta/exact";
  const exact = customMetaschema("draft-2020-12", uri, {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const alias = customMetaschema("draft-2019-09", uri, {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const preparedResults = await Promise.all(
    [
      { "https://example.test/meta/alias": alias, [uri]: exact },
      { [uri]: exact, "https://example.test/meta/alias": alias },
    ].map(async (externalSchemas) => {
      const prepared = await prepareSchema(
        { $schema: uri, type: "string" },
        jsonSchemaInputPluginOptionsSchema.parse({ externalSchemas, validator: "none" }),
      );
      return prepared;
    }),
  );
  for (const result of preparedResults) {
    const prepared = expectOk(result);
    assert.equal(prepared.value.dialect, "draft-2020-12");
  }
});

void test("normalizes a trailing fragment when resolving a custom metaschema identifier", async () => {
  const uri = "https://example.test/meta/alias-fragment";
  const metaschema = customMetaschema("draft-2020-12", uri, {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const prepared = await prepareSchema(
    { $schema: `${uri}#`, type: "string" },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: { "https://registry.example.test/meta.json": metaschema },
      validator: "none",
    }),
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.value.dialect, "draft-2020-12");
});

void test("resolves a relative custom metaschema identifier from its retrieval URI", async () => {
  const metaschema = customMetaschema("draft-2020-12", "custom-meta", {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const prepared = await prepareSchema(
    { $schema: "https://registry.example.test/path/custom-meta", type: "string" },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: { "https://registry.example.test/path/container.json": metaschema },
      validator: "none",
    }),
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.value.dialect, "draft-2020-12");
});

void test("fails deterministically for ambiguous custom metaschema identifiers", async () => {
  const uri = "https://registry.example.test/path/custom-meta";
  const draft2020 = customMetaschema("draft-2020-12", "custom-meta", {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const draft2019 = customMetaschema("draft-2019-09", "custom-meta", {
    applicator: true,
    core: true,
    unevaluated: true,
  });
  const preparedResults = await Promise.all(
    [
      {
        "https://registry.example.test/path/a.json": draft2020,
        "https://registry.example.test/path/b.json": draft2019,
      },
      {
        "https://registry.example.test/path/b.json": draft2019,
        "https://registry.example.test/path/a.json": draft2020,
      },
    ].map(async (externalSchemas) => {
      const prepared = await prepareSchema(
        { $schema: uri, type: "string" },
        jsonSchemaInputPluginOptionsSchema.parse({ externalSchemas, validator: "none" }),
      );
      return prepared;
    }),
  );
  const diagnostics = preparedResults.map((prepared) => {
    assert.equal(prepared.ok, false);
    return prepared.diagnostics;
  });

  assert.deepEqual(diagnostics[0], diagnostics[1]);
  assert.equal(diagnostics[0]?.[0]?.code, "invalid_schema_document");
});

void test("preflight selects an exact metaschema retrieval before canonical aliases", async () => {
  const uri = "https://example.test/meta/preflight-exact";
  const exact = customMetaschema("draft-2020-12", uri, {
    applicator: true,
    core: true,
    unevaluated: true,
    validation: true,
  });
  const alias = customMetaschema("draft-2019-09", uri, {
    applicator: true,
    core: true,
    unevaluated: true,
    validation: true,
  });
  const prepared = await prepareSchema(
    { $schema: uri, type: "string" },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: { "https://example.test/meta/alias": alias, [uri]: exact },
    }),
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.value.dialect, "draft-2020-12");
});

void test("preflight orders a metaschema before a relative-identifier dependent", async () => {
  const baseUri = "https://registry.example.test/path/base-meta";
  const childUri = "https://registry.example.test/path/child-meta";
  const base = customMetaschema("draft-2020-12", "base-meta", {
    applicator: true,
    core: true,
    unevaluated: true,
    validation: true,
  });
  const child: Record<string, unknown> = {
    ...customMetaschema("draft-2020-12", "child-meta", {
      applicator: true,
      core: true,
      unevaluated: true,
      validation: true,
    }),
    $schema: `${baseUri}#`,
  };
  const prepared = await prepareSchema(
    { $schema: childUri, type: "string" },
    jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        "https://registry.example.test/path/a-child.json": child,
        "https://registry.example.test/path/z-base.json": base,
      },
    }),
  );

  assert.equal(prepared.ok, true);
  assert.equal(base["$id"], "base-meta");
  assert.equal(child["$id"], "child-meta");
});

void test("fails loudly when an omitted applicator vocabulary is used", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/no-applicator";
  const options = optionsFor(dialect, uri, { core: true, unevaluated: true, validation: true });
  const prepared = expectOk(
    await prepareSchema({ $schema: uri, properties: { value: { type: "string" } } }, options),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, false);
  const diagnostic = lowered.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
  assert.ok(diagnostic);
  assert.equal(diagnostic.location?.pointer, "/properties");
});

void test("fails loudly when an omitted unevaluated vocabulary is used", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/no-unevaluated";
  const options = optionsFor(dialect, uri, { applicator: true, core: true, validation: true });
  const prepared = expectOk(
    await prepareSchema({ $schema: uri, type: "object", unevaluatedProperties: false }, options),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, false);
  const diagnostic = lowered.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
  assert.ok(diagnostic);
  assert.equal(diagnostic.location?.pointer, "/unevaluatedProperties");
});

void test("requires a custom dialect to declare its core vocabulary", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/core-optional";
  const options = optionsFor(dialect, uri, { applicator: true, core: false, unevaluated: true });
  const prepared = await prepareSchema(
    { $schema: uri, type: "string" },
    { ...options, validator: "none" },
  );

  assert.equal(prepared.ok, false);
  const diagnostic = prepared.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
  assert.ok(diagnostic);
  assert.equal(diagnostic.location?.pointer, "/$schema");
});

void test("assumes stock vocabularies when a custom dialect omits $vocabulary", async () => {
  const uri = "https://example.test/draft-2020-12/meta/no-vocabulary";
  const options = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: { [uri]: { $id: uri, $schema: stockSchemaUri("draft-2020-12") } },
    validator: "none",
  });
  const prepared = expectOk(
    await prepareSchema(
      {
        $schema: uri,
        properties: { value: { type: "string" } },
        type: "object",
        unevaluatedProperties: false,
      },
      options,
    ),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, true);
});

void test("allows omitted foundational vocabularies when their keywords are unreachable", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/core-only";
  const options = optionsFor(dialect, uri, { core: true });
  const prepared = expectOk(
    await prepareSchema(
      {
        $defs: { unused: { properties: { value: true }, unevaluatedProperties: false } },
        $schema: uri,
        type: "string",
      },
      { ...options, validator: "none" },
    ),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, true);
});

void test("implements foundational vocabularies declared optional", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/optional-foundations";
  const options = optionsFor(dialect, uri, {
    applicator: false,
    core: true,
    unevaluated: false,
    validation: true,
  });
  const prepared = expectOk(
    await prepareSchema(
      { $schema: uri, properties: { value: { type: "string" } }, unevaluatedProperties: true },
      { ...options, validator: "none" },
    ),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, true);
});

void test("does not attribute a cross-dialect keyword to an omitted vocabulary", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/core-only-cross-dialect";
  const options = optionsFor(dialect, uri, { core: true });
  const prepared = expectOk(
    await prepareSchema(
      { $schema: uri, additionalItems: false },
      { ...options, validator: "none" },
    ),
  );

  const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
  assert.equal(lowered.ok, false);
  assert.ok(lowered.diagnostics.some(({ code }) => code === "unknown_keyword"));
  assert.equal(
    lowered.diagnostics.some(({ code }) => code === "unsupported_vocabulary"),
    false,
  );
});

for (const dialect of ["draft-2019-09", "draft-2020-12"] as const)
  void test(`${dialect} infers the base dialect and ignores absent validation vocabulary`, async () => {
    const uri = `https://example.test/${dialect}/meta/no-validation`;
    const options = optionsFor(dialect, uri, { applicator: true, core: true });
    const prepared = expectOk(
      await prepareSchema({ $schema: uri, properties: { amount: { minimum: 10 } } }, options),
    );

    assert.equal(prepared.value.dialect, dialect);
    assert.equal(prepared.value.formatAssertionVocabulary, false);
    assert.equal(prepared.value.validationVocabulary, false);
    const lowered = expectOk(await jsonSchemaInputPlugin.lower(prepared, options));
    assert.doesNotMatch(JSON.stringify(lowered), /gte|minimum/u);
  });

void test("ignores unrecognized optional vocabularies", async () => {
  const dialect = "draft-2020-12" as const;
  const uri = "https://example.test/draft-2020-12/meta/optional";
  const options = optionsFor(dialect, uri, {
    additional: { "https://example.test/vocab/custom": false },
    core: true,
    validation: true,
  });
  const prepared = await prepareSchema({ $schema: uri, type: "number" }, options);
  assert.equal(prepared.ok, true);
});
