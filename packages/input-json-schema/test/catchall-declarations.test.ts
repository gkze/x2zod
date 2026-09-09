import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
} from "../../../test/native-source-harness";
import type { JsonSchemaValue } from "../src";
import { generateSchemaFixture } from "./schema-fixture-harness";

type Codec = Readonly<{ encode: (value: unknown) => unknown }>;
const isCodec = (value: unknown): value is Codec =>
  isRecord(value) && typeof value["encode"] === "function";

// Optional own prototype keys intersect typed catchalls. Emission alone can succeed even when
// TypeScript serializes that intersection into an invalid declaration literal (TS2411).
for (const runtimeMode of ["inline", "shared"] as const)
  for (const transform of [false, true])
    void test(`typed catchall declarations remain consumable (${runtimeMode}, transform: ${String(transform)})`, async () => {
      const directory = createTemporaryDirectory({
        prefix: "catchall-declarations-",
        rootDirectory: path.join(import.meta.dirname, "../node_modules/.cache"),
      });
      const schema: JsonSchemaValue = {
        type: "object",
        properties: {
          declared: {
            type: "object",
            properties: { ["__proto__"]: { type: "string" } },
            additionalProperties: false,
          },
          labels: {
            type: "object",
            propertyNames: { not: { const: "forbidden" } },
            additionalProperties: {
              type: "object",
              required: ["first_name"],
              properties: { first_name: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        required: ["labels"],
        additionalProperties: false,
      };
      const outputKey = transform ? "firstName" : "first_name";
      const declaredKey = transform ? "Proto" : "__proto__";
      try {
        const validator = await generateSchemaFixture(directory, schema, {
          runtimeMode,
          transforms: transform
            ? [
                {
                  kind: "map-properties",
                  options: { keys: { kind: "case", decodedCase: "camelCase" } },
                },
              ]
            : [],
          consumerSource: [
            'import { fixtureSchema } from "./generated";',
            'import type { z } from "zod/v4";',
            "type Input = z.input<typeof fixtureSchema>;",
            "type Output = z.output<typeof fixtureSchema>;",
            "type Assert<T extends true> = T;",
            "export const empty: Input = { labels: {} };",
            'export const input: Input = { labels: { key: { first_name: "ok" } } };',
            `export const output: Output = { labels: { key: { ${outputKey}: "ok" } } };`,
            "export type RejectsInput = Assert<{ labels: { key: { first_name: number } } } extends Input ? false : true>;",
            `export type RejectsOutput = Assert<{ labels: { key: { ${outputKey}: number } } } extends Output ? false : true>;`,
            "export const parse = (value: unknown) => fixtureSchema.parse(value);",
          ].join("\n"),
        });
        const value: unknown = JSON.parse(
          '{"declared":{"__proto__":"declared"},"labels":{"__proto__":{"first_name":"kept"},"Proto":{"first_name":"dynamic"},"key":{"first_name":"ok"}}}',
        );
        const expected: unknown = JSON.parse(
          `{"declared":{"${declaredKey}":"declared"},"labels":{"__proto__":{"${outputKey}":"kept"},"Proto":{"${outputKey}":"dynamic"},"key":{"${outputKey}":"ok"}}}`,
        );
        assert.deepEqual(validator.safeParse(value), { success: true, data: expected });
        const codec = await importGeneratedExport(
          path.join(directory, "generated.ts"),
          "fixtureSchema",
          isCodec,
        );
        assert.deepEqual(codec.encode(expected), value);
        assert.deepEqual(validator.safeParse({ labels: {} }), {
          success: true,
          data: { labels: {} },
        });
        assert.equal(
          validator.safeParse({ labels: { forbidden: { first_name: "no" } } }).success,
          false,
        );
        assert.equal(validator.safeParse({ labels: { key: { first_name: 1 } } }).success, false);
        assert.equal(
          validator.safeParse({ labels: {}, declared: { ["__proto__"]: 1 } }).success,
          false,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

for (const runtimeMode of ["inline", "shared"] as const)
  void test(`prototype pattern names retain exact validation in ${runtimeMode} mode`, async () => {
    const directory = createTemporaryDirectory({
      prefix: "prototype-pattern-",
      rootDirectory: path.join(import.meta.dirname, "../node_modules/.cache"),
    });
    try {
      const validator = await generateSchemaFixture(
        directory,
        {
          type: "object",
          patternProperties: { ["__proto__"]: { type: "string" } },
          additionalProperties: false,
        },
        { runtimeMode },
      );
      const value: unknown = JSON.parse('{"__proto__":"own","prefix__proto__suffix":"pattern"}');
      assert.deepEqual(validator.safeParse(value), { success: true, data: value });
      assert.equal(validator.safeParse({ ["__proto__"]: 1 }).success, false);
      assert.equal(validator.safeParse({ prefix__proto__suffix: 1 }).success, false);
      assert.equal(validator.safeParse({ extra: "no" }).success, false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
