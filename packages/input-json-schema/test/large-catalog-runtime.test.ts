import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createTemporaryDirectory,
  importGeneratedExport,
} from "../../../test/native-source-harness";
import type { JsonSchemaValue } from "../src";
import { generateSchemaFixture, isFixtureValidator } from "./schema-fixture-harness";

// Exercise the first wide composition while keeping the strict consumer regression bounded.
const maximumSourceBytes = 1_048_576;
const branchCount = 33;
const definitions = Object.fromEntries(
  Array.from({ length: branchCount }, (_value, index) => [
    `Message${index.toString()}`,
    {
      type: "object",
      minProperties: 1,
      properties: {
        kind: { enum: [`message${index.toString()}`] },
        count: { type: "integer", minimum: 0 },
        label: { type: ["string", "null"] },
      },
      required: ["kind", "count", "label"],
      additionalProperties: false,
    },
  ]),
);
const catalog: JsonSchemaValue = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  definitions,
  properties: {
    ...Object.fromEntries(
      Object.keys(definitions).map((name) => [name, { $ref: `#/definitions/${name}` }]),
    ),
    message: { oneOf: Object.keys(definitions).map((name) => ({ $ref: `#/definitions/${name}` })) },
  },
};

for (const runtimeMode of ["inline", "shared"] as const)
  void test(`strictly compiles a wide catalog with exact ${runtimeMode} validators`, async (context) => {
    const directory = createTemporaryDirectory({
      prefix: "large-catalog-",
      rootDirectory: path.join(import.meta.dirname, "../node_modules/.cache"),
    });
    try {
      const validator = await generateSchemaFixture(directory, catalog, {
        runtimeMode,
        declarationExportMode: "all",
        pluginOptions: { unknownKeywords: "reject" },
        onMetrics: (metrics) => {
          // A bounded synthetic catalog should not grow into multi-megabyte output. Wall-clock
          // Measurements are diagnostics; the harness owns the subprocess deadlines.
          assert.ok(metrics.sourceBytes < maximumSourceBytes, JSON.stringify(metrics));
          context.diagnostic(JSON.stringify({ runtimeMode, branchCount, ...metrics }));
        },
        consumerSource: [
          'import { fixtureSchema, message0Schema } from "./generated";',
          'import type { z } from "zod/v4";',
          "type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;",
          'export const count: Equal<z.infer<typeof message0Schema>["count"], number> = true;',
          'export const kind: Equal<z.infer<typeof message0Schema>["kind"], "message0"> = true;',
          'export const label: Equal<z.infer<typeof message0Schema>["label"], string | null> = true;',
          'export const optionalEntry: Equal<z.infer<typeof fixtureSchema>["Message0"], z.infer<typeof message0Schema> | undefined> = true;',
        ].join("\n"),
      });
      const independent = await importGeneratedExport(
        path.join(directory, "generated.ts"),
        "message0Schema",
        isFixtureValidator,
      );
      const message = { kind: "message0", count: 2, label: null };
      assert.equal(independent.safeParse(message).success, true);
      assert.deepEqual(validator.safeParse({}), { success: true, data: {} });
      assert.equal(validator.safeParse({ message, Message0: message, extra: true }).success, true);
      for (const value of [
        { ...message, count: -1 },
        { ...message, count: 0.5 },
        { ...message, kind: "unknown" },
        { ...message, label: 1 },
        { ...message, extra: true },
        { kind: "message0", count: 2 },
      ]) {
        assert.equal(independent.safeParse(value).success, false);
        assert.equal(validator.safeParse({ message: value }).success, false);
        assert.equal(validator.safeParse({ Message0: value }).success, false);
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
