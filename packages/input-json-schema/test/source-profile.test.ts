import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";
import type { CompileToZodSourceResult } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";

const compileSchema = async (
  id: string,
  schema: JsonSchemaValue,
  pluginOptions: JsonSchemaInputPluginOptionsInput,
): Promise<CompileToZodSourceResult> => {
  const result = await compileToZodSource({
    document: { source: { id, kind: "inline" }, text: JSON.stringify(schema) },
    output: { typeName: "SourceProfileSchema" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions,
  });
  return result;
};

void test("treats OpenCode ref metadata as inert profile data", async () => {
  const result = await compileSchema(
    "opencode-ref",
    { ref: "Config", type: "object" },
    { sourceProfile: "opencode", validator: "none" },
  );

  assert.equal(result.ok, true);
  assert.ok(
    result.diagnostics?.some((diagnostic) => diagnostic.code === "json-schema/ignored-keyword") ===
      true,
  );
});

void test("keeps compatibility metadata behind its source profile", async () => {
  const results = await Promise.all(
    (
      [
        { keywords: ["allowComments", "allowTrailingCommas"], sourceProfile: "opencode" },
        { keywords: ["tsType", "x-intellij-language-injection"], sourceProfile: "schemastore" },
      ] as const
    ).flatMap(({ keywords, sourceProfile }) =>
      keywords.map(async (keyword) => {
        const schema = { [keyword]: true, type: "object" } satisfies JsonSchemaValue;
        return {
          profiled: await compileSchema(`${keyword}-${sourceProfile}`, schema, {
            sourceProfile,
            validator: "none",
          }),
          strict: await compileSchema(`${keyword}-strict`, schema, { validator: "none" }),
        };
      }),
    ),
  );

  for (const { profiled, strict } of results) {
    assert.equal(strict.ok, false);
    assert.ok(strict.diagnostics.some((diagnostic) => diagnostic.code === "unknown_keyword"));
    assert.equal(profiled.ok, true);
    assert.ok(
      profiled.diagnostics?.some(
        (diagnostic) => diagnostic.code === "json-schema/ignored-keyword",
      ) === true,
    );
  }
});

void test("keeps unknown keywords strict in the SchemaStore profile", async () => {
  const result = await compileSchema(
    "schemastore-unknown",
    { unsupportedVendorKeyword: true, type: "object" },
    { sourceProfile: "schemastore", validator: "none" },
  );

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown_keyword"));
});

void test("rejects declaration containers from a different dialect", async () => {
  const results = await Promise.all(
    [
      { dialect: "draft-2020-12" as const, keyword: "definitions" },
      { dialect: "draft-2019-09" as const, keyword: "definitions" },
      { dialect: "draft-7" as const, keyword: "$defs" },
    ].map(async ({ dialect, keyword }) => ({
      keyword,
      result: await compileSchema(
        `${dialect}-${keyword}`,
        { [keyword]: { value: { type: "string" } }, type: "object" },
        { dialect, validator: "none" },
      ),
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

void test("keeps cross-dialect declaration addresses behind the OpenCode profile", async () => {
  const results = await Promise.all(
    [
      { dialect: "draft-2020-12" as const, keyword: "definitions" },
      { dialect: "draft-2019-09" as const, keyword: "definitions" },
      { dialect: "draft-7" as const, keyword: "$defs" },
    ].map(async ({ dialect, keyword }) => {
      const result = await compileSchema(
        `${dialect}-${keyword}-opencode`,
        { $ref: `#/${keyword}/value`, [keyword]: { value: { type: "string" } } },
        { dialect, sourceProfile: "opencode", validator: "none" },
      );
      return result;
    }),
  );

  for (const result of results) {
    assert.equal(result.ok, true);
    assert.ok(
      result.diagnostics?.some(
        (diagnostic) => diagnostic.code === "json-schema/ignored-keyword",
      ) === true,
    );
  }
});
