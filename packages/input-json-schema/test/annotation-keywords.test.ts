import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileToZodSource } from "@x2zod/core";
import type { CompileToZodSourceResult, ts } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonSchemaValue } from "../src";

const compileSchema = async (schema: JsonSchemaValue): Promise<CompileToZodSourceResult> => {
  const result = await compileToZodSource({
    document: {
      source: { id: "annotation-keywords", kind: "inline" },
      text: JSON.stringify(schema),
    },
    output: { typeName: "AnnotatedValue" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  return result;
};

const expectSourceFile = (result: CompileToZodSourceResult): ts.SourceFile => {
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));

  return result.value.sourceFile;
};

void describe("JSON Schema annotation keywords", () => {
  void test("deprecated, readOnly, and writeOnly do not change generated validation", async () => {
    const [baseline, annotated] = await Promise.all([
      compileSchema({ type: "string" }),
      compileSchema({ deprecated: true, readOnly: true, type: "string", writeOnly: true }),
    ]);

    assert.deepEqual(expectSourceFile(annotated), expectSourceFile(baseline));
  });
});
