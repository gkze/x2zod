import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import { compileGeneratedSchema } from "./generated-schema-harness";
import {
  customMetaschema,
  expectOk,
  optionsFor,
  prepareSchema,
  stockSchemaUri,
} from "./vocabulary-test-support";

void describe("custom vocabulary runtime policy", () => {
  void test("keeps omitted validation inactive in the unevaluated evaluator", async () => {
    const metaUri = "https://example.com/model.schema.json";
    const { generatedSchema, source } = await compileGeneratedSchema(
      {
        $schema: metaUri,
        maxProperties: 0,
        properties: { name: { type: "string" } },
        type: "object",
        unevaluatedProperties: false,
      },
      {
        externalSchema: customMetaschema("draft-2020-12", metaUri, {
          applicator: true,
          core: true,
          unevaluated: true,
        }),
      },
    );

    assert.match(source, /x2zodEvaluate/u);
    assert.equal(generatedSchema.safeParse({ name: "accepted" }).success, true);
    assert.equal(generatedSchema.safeParse({ name: 42 }).success, true);
    assert.equal(generatedSchema.safeParse({ other: true }).success, false);
  });
});

void describe("resource-local vocabulary policies", () => {
  for (const dialect of ["draft-2019-09", "draft-2020-12"] as const)
    void test(`${dialect} processes an explicitly optional validation vocabulary`, async () => {
      const uri = `https://example.test/${dialect}/meta/validation-optional`;
      const options = optionsFor(dialect, uri, { core: true, validation: false });
      const prepared = expectOk(
        await prepareSchema({ $schema: uri, minimum: 10, type: "number" }, options),
      );

      assert.equal(prepared.value.validationVocabulary, true);
      const lowered = expectOk(await jsonSchemaInputPlugin.lower(prepared, options));
      const [declaration] = lowered.declarations;
      assert.ok(declaration);
      const { expression } = declaration;
      if (expression.kind !== "factory") throw new Error("Expected a factory expression.");
      assert.equal(expression.factory, "number");
      assert.equal(expression.calls?.[0]?.method, "gte");
    });

  void test("keeps equal unused canonical identifiers location-scoped across selected documents", async () => {
    const firstUri = "https://example.test/resource/first";
    const secondUri = "https://example.test/resource/second";
    const sharedNestedId = "urn:example:unused-shared";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [firstUri]: {
          $defs: {
            nested: {
              $id: sharedNestedId,
              $schema: "http://json-schema.org/draft-07/schema#",
              items: [{ type: "string" }],
              type: "array",
            },
          },
          type: "string",
        },
        [secondUri]: {
          $defs: {
            nested: {
              $id: sharedNestedId,
              $schema: stockSchemaUri("draft-2020-12"),
              prefixItems: [{ type: "string" }],
              type: "array",
            },
          },
          type: "string",
        },
      },
    });
    const result = await jsonSchemaInputPlugin.prepare(
      {
        source: { id: "location-scoped-policies", kind: "inline" },
        text: JSON.stringify({ allOf: [{ $ref: firstUri }, { $ref: secondUri }], type: "string" }),
      },
      options,
    );

    assert.equal(result.ok, true);
  });
});

void describe("resource-local assertion policies", () => {
  void test("keeps referenced stock-resource validation independent of an omitted root vocabulary", async () => {
    const dialect = "draft-2020-12" as const;
    const uri = "https://example.test/draft-2020-12/meta/validation-omitted-reference";
    const resourceUri = "https://example.test/draft-2020-12/resource.json";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [uri]: customMetaschema(dialect, uri, { applicator: true, core: true }),
        [resourceUri]: {
          $id: resourceUri,
          $schema: stockSchemaUri(dialect),
          minimum: 10,
          type: "number",
        },
      },
      validator: "none",
    });
    const prepared = expectOk(await prepareSchema({ $ref: resourceUri, $schema: uri }, options));
    const lowered = expectOk(await jsonSchemaInputPlugin.lower(prepared, options));
    const resource = lowered.declarations.find((declaration) =>
      declaration.symbol.includes(resourceUri),
    );
    assert.ok(resource);
    const { expression } = resource;
    if (expression.kind !== "factory") throw new Error("Expected a factory expression.");
    assert.equal(expression.factory, "number");
    assert.equal(expression.calls?.[0]?.method, "gte");
  });
});

void describe("resource-local validation policies", () => {
  void test("keeps omitted external validation independent of a stock root", async () => {
    const dialect = "draft-2020-12" as const;
    const metaUri = "https://example.test/draft-2020-12/meta/external-no-validation";
    const resourceUri = "https://example.test/draft-2020-12/external-no-validation.json";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [metaUri]: customMetaschema(dialect, metaUri, { applicator: true, core: true }),
        [resourceUri]: { $id: resourceUri, $schema: metaUri, minimum: 10, type: "number" },
      },
      validator: "none",
    });
    const prepared = expectOk(
      await prepareSchema(
        { $schema: stockSchemaUri(dialect), $ref: resourceUri },
        options,
        "stock.json",
      ),
    );
    const lowered = expectOk(await jsonSchemaInputPlugin.lower(prepared, options));
    const resource = lowered.declarations.find((declaration) =>
      declaration.symbol.includes(resourceUri),
    );
    assert.ok(resource);
    assert.doesNotMatch(JSON.stringify(resource), /gte|minimum/u);
  });
});

void describe("resource-local format policies", () => {
  void test("keeps external format assertion and annotation policies independent", async () => {
    const dialect = "draft-2020-12" as const;
    const formatUri = "https://example.test/draft-2020-12/meta/format-assertion-reference";
    const formatResourceUri = "https://example.test/draft-2020-12/format-resource.json";
    const annotationResourceUri = "https://example.test/draft-2020-12/annotation-resource.json";
    const formatOptions = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [formatUri]: customMetaschema(dialect, formatUri, {
          core: true,
          formatAssertion: true,
          validation: true,
        }),
        [formatResourceUri]: {
          $id: formatResourceUri,
          $schema: formatUri,
          format: "email",
          type: "string",
        },
      },
      validator: "none",
    });
    const formatPrepared = expectOk(
      await prepareSchema(
        { $ref: formatResourceUri, $schema: stockSchemaUri(dialect) },
        formatOptions,
      ),
    );
    const formatLowered = await jsonSchemaInputPlugin.lower(formatPrepared, formatOptions);
    assert.equal(formatLowered.ok, false);
    assert.ok(
      formatLowered.diagnostics.some(({ code }) => code === "json-schema/unsupported-format"),
    );

    const annotationOptions = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [formatUri]: customMetaschema(dialect, formatUri, {
          core: true,
          formatAssertion: true,
          validation: true,
        }),
        [annotationResourceUri]: {
          $id: annotationResourceUri,
          $schema: stockSchemaUri(dialect),
          format: "email",
          type: "string",
        },
      },
      validator: "none",
    });
    const annotationPrepared = expectOk(
      await prepareSchema({ $ref: annotationResourceUri, $schema: formatUri }, annotationOptions),
    );
    const annotationLowered = await jsonSchemaInputPlugin.lower(
      annotationPrepared,
      annotationOptions,
    );
    assert.equal(annotationLowered.ok, true);
  });
});

void describe("required resource vocabulary diagnostics", () => {
  void test("fails loudly for an unrecognized required vocabulary", async () => {
    const dialect = "draft-2020-12" as const;
    const uri = "https://example.test/draft-2020-12/meta/required";
    const options = optionsFor(dialect, uri, {
      additional: { "https://example.test/vocab/custom": true },
      core: true,
      validation: true,
    });
    const result = await prepareSchema(
      { $schema: uri, type: "number" },
      { ...options, validator: "none" },
    );
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
    assert.ok(diagnostic);
    assert.equal(diagnostic.location?.pointer, "/$schema");
    assert.equal(diagnostic.location.sourceSpan?.file, "custom.json");
    assert.equal(diagnostic.location.sourceSpan.start.line, 1);
  });

  void test("fails loudly for a required unknown vocabulary in a referenced external resource", async () => {
    const dialect = "draft-2020-12" as const;
    const badMetaUri = "https://example.test/draft-2020-12/meta/external-required";
    const resourceUri = "https://example.test/draft-2020-12/external-required.json";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [badMetaUri]: customMetaschema(dialect, badMetaUri, {
          additional: { "https://example.test/vocab/unknown": true },
          core: true,
        }),
        [resourceUri]: { $id: resourceUri, $schema: badMetaUri, type: "string" },
      },
      validator: "none",
    });
    const prepared = expectOk(
      await prepareSchema({ $ref: resourceUri, $schema: stockSchemaUri(dialect) }, options),
    );
    const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
    assert.equal(lowered.ok, false);
    const diagnostic = lowered.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
    assert.ok(diagnostic);
    assert.equal(diagnostic.location?.pointer, "/$schema");
    assert.equal(diagnostic.location.sourceSpan, undefined);
  });
});

void describe("embedded resource vocabulary diagnostics", () => {
  void test("preflights every resource in a selected document under its vocabulary", async () => {
    const dialect = "draft-2020-12" as const;
    const metaUri = "https://example.test/draft-2020-12/meta/embedded-no-applicator";
    const resourceUri = "https://example.test/draft-2020-12/selected-container";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [metaUri]: customMetaschema(dialect, metaUri, { core: true, validation: true }),
        [resourceUri]: {
          $defs: {
            embedded: {
              $id: "embedded",
              $schema: metaUri,
              properties: { value: { type: "string" } },
            },
          },
          $id: resourceUri,
          type: "string",
        },
      },
    });
    const result = await jsonSchemaInputPlugin.prepare(
      {
        source: { id: "selected-container", kind: "inline" },
        text: JSON.stringify({ $ref: resourceUri, $schema: stockSchemaUri(dialect) }),
      },
      options,
    );

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code }) => code === "unsupported_vocabulary"));
  });

  void test("source-locates required unknown vocabularies in embedded root resources", async () => {
    const dialect = "draft-2020-12" as const;
    const badMetaUri = "https://example.test/draft-2020-12/meta/embedded-required";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [badMetaUri]: customMetaschema(dialect, badMetaUri, {
          additional: { "https://example.test/vocab/unknown": true },
          core: true,
        }),
      },
      validator: "none",
    });
    const prepared = expectOk(
      await prepareSchema(
        {
          $defs: { embedded: { $id: "embedded", $schema: badMetaUri, type: "string" } },
          $ref: "embedded",
          $schema: stockSchemaUri(dialect),
        },
        options,
        "embedded-required.json",
      ),
    );

    const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
    assert.equal(lowered.ok, false);
    const diagnostic = lowered.diagnostics.find(({ code }) => code === "unsupported_vocabulary");
    assert.ok(diagnostic);
    assert.equal(diagnostic.location?.pointer, "/$defs/embedded/$schema");
    assert.equal(diagnostic.location.sourceSpan?.file, "embedded-required.json");
  });

  void test("inherits omitted validation vocabulary for an embedded resource", async () => {
    const dialect = "draft-2020-12" as const;
    const metaUri = "https://example.test/draft-2020-12/meta/embedded-inherit";
    const resourceUri = "https://example.test/draft-2020-12/embedded.json";
    const options = jsonSchemaInputPluginOptionsSchema.parse({
      dialect,
      externalSchemas: {
        [metaUri]: customMetaschema(dialect, metaUri, { applicator: true, core: true }),
      },
      validator: "none",
    });
    const prepared = expectOk(
      await prepareSchema(
        {
          $schema: metaUri,
          $defs: { embedded: { $id: resourceUri, minimum: 10, type: "number" } },
          $ref: resourceUri,
        },
        options,
      ),
    );
    const lowered = expectOk(await jsonSchemaInputPlugin.lower(prepared, options));
    const resource = lowered.declarations.find(
      (declaration) => declaration.nameHints?.some(({ value }) => value === "embedded") === true,
    );
    assert.ok(resource);
    assert.doesNotMatch(JSON.stringify(resource), /gte|minimum/u);
  });
});

void describe("format assertion vocabulary", () => {
  for (const dialect of ["draft-2019-09", "draft-2020-12"] as const)
    void test(`${dialect} fails loudly when a required format assertion has no active profile`, async () => {
      const uri = `https://example.test/${dialect}/meta/format-assertion`;
      const options = optionsFor(dialect, uri, {
        core: true,
        formatAssertion: true,
        validation: true,
      });
      const prepared = expectOk(
        await prepareSchema(
          { $schema: uri, format: "email", type: "string" },
          { ...options, validator: "none" },
        ),
      );

      assert.equal(prepared.value.formatAssertionVocabulary, true);
      const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
      assert.equal(lowered.ok, false);
      assert.ok(lowered.diagnostics.some(({ code }) => code === "json-schema/unsupported-format"));
    });

  for (const dialect of ["draft-2019-09", "draft-2020-12"] as const)
    void test(`${dialect} applies required format assertion policy to embedded resources`, async () => {
      const uri = `https://example.test/${dialect}/meta/embedded-format-assertion`;
      const options = optionsFor(dialect, uri, {
        core: true,
        formatAssertion: true,
        validation: true,
      });
      const prepared = expectOk(
        await prepareSchema(
          {
            $schema: stockSchemaUri(dialect),
            $defs: { embedded: { $id: "embedded", $schema: uri, format: "email", type: "string" } },
            $ref: "embedded",
          },
          { ...options, validator: "none" },
          "embedded.json",
        ),
      );

      const lowered = await jsonSchemaInputPlugin.lower(prepared, options);
      assert.equal(lowered.ok, false);
      assert.ok(lowered.diagnostics.some(({ code }) => code === "json-schema/unsupported-format"));
    });
});
