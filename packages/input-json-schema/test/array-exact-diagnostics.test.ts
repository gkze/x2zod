import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";

const malformedTupleEntry = 42;

void test("tuple items still diagnose non-schema entries without validator preflight", async () => {
  const result = await compileToZodSource({
    document: {
      source: { id: "malformed-tuple-entry", kind: "inline" },
      text: JSON.stringify({ items: [{ type: "string" }, malformedTupleEntry], type: "array" }),
    },
    output: { typeName: "MalformedTuple" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { dialect: "draft-7", validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid_schema_document" &&
        diagnostic.location?.pointer === "/items/1",
    ),
  );
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_keyword"),
    false,
  );
});
