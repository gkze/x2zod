import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";

const compileDraft7 = async (
  schema: JsonSchemaValue,
): Promise<Awaited<ReturnType<typeof compileToZodSource>>> => {
  const result = await compileToZodSource({
    document: {
      source: { id: "dependencies-diagnostics", kind: "inline" },
      text: JSON.stringify(schema),
    },
    output: { typeName: "DependenciesDiagnostic" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { dialect: "draft-7", validator: "none" },
  });
  return result;
};

void describe("Draft 7 dependencies diagnostics", () => {
  void test("recursively diagnoses schema-valued dependency entries", async () => {
    const result = await compileDraft7({
      dependencies: { feature: { inventedKeyword: true } },
      type: "object",
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unknown_keyword" &&
          diagnostic.location?.pointer === "/dependencies/feature/inventedKeyword",
      ),
    );
  });

  void test("does not treat property dependency arrays as schemas", async () => {
    const result = await compileDraft7({
      dependencies: { feature: ["name"] },
      properties: { feature: { type: "boolean" }, name: { type: "string" } },
      type: "object",
    });

    assert.equal(result.ok, true);
  });
});
