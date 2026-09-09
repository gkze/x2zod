import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import nodePath from "node:path";
import { test } from "node:test";

import {
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
} from "../../../test/native-source-harness";
import type { JsonSchemaValue } from "../src";
import { generateSchemaFixture, isFixtureValidator } from "./schema-fixture-harness";

const nodeUri = "https://example.test/node";
const textUri = "https://example.test/text";
const nodeSchema: JsonSchemaValue = {
  $id: nodeUri,
  title: "Node",
  type: "object",
  required: ["value_name"],
  properties: { value_name: { $ref: textUri }, child: { $ref: nodeUri } },
  propertyNames: { not: { const: "forbidden" } },
  additionalProperties: false,
};
const textSchema: JsonSchemaValue = { $id: textUri, type: "string", minLength: 1 };
const accepted = [{ value_name: "root" }, { value_name: "root", child: { value_name: "leaf" } }];
const rejected = [
  {},
  { value_name: "" },
  { value_name: 1 },
  { value_name: "root", child: {} },
  { value_name: "root", forbidden: true },
];

const consumerSource = [
  'import { fixtureSchema, nodeSchema } from "./generated";',
  'import type { z } from "zod/v4";',
  "type Input = z.input<typeof nodeSchema>;",
  "type Output = z.output<typeof nodeSchema>;",
  "type Assert<T extends true> = T;",
  'export type InputName = Assert<Input["value_name"] extends string ? true : false>;',
  'export type OutputName = Assert<Output["value_name"] extends string ? true : false>;',
  "export type RejectsWrongField = Assert<{ value_name: number } extends Input ? false : true>;",
  "export type RequiresName = Assert<{} extends Output ? false : true>;",
  "export type RejectsWrongChild = Assert<{ value_name: string; child: { value_name: number } } extends Output ? false : true>;",
  'export const leaf: Input = { value_name: "leaf" };',
  'export const tree: Output = { value_name: "root", child: leaf };',
  "export const parse = (value: unknown) => fixtureSchema.parse(value);",
].join("\n");

for (const runtimeMode of ["inline", "shared"] as const)
  for (const annotated of [false, true])
    void test(`recursive exports preserve semantics through resource order and annotations in ${runtimeMode} mode (annotations: ${String(annotated)})`, async () => {
      // Fixed IDs and expected values are the oracle; variants change only representation.
      const directory = createTemporaryDirectory({
        prefix: "consumer-equivalence-",
        rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
      });
      try {
        const externalSchemas = annotated
          ? {
              [textUri]: textSchema,
              [nodeUri]: { ...nodeSchema, xNote: { arbitrary: ["metadata"] } },
            }
          : { [nodeUri]: nodeSchema, [textUri]: textSchema };
        const root = await generateSchemaFixture(
          directory,
          { $ref: nodeUri },
          {
            runtimeMode,
            declarationExportMode: "all",
            pluginOptions: { externalSchemas, inertKeywords: { xNote: "object" } },
            consumerSource,
          },
        );
        const independent = await importGeneratedExport(
          nodePath.join(directory, "generated.ts"),
          "nodeSchema",
          isFixtureValidator,
        );
        for (const validator of [root, independent]) {
          for (const value of accepted)
            assert.deepEqual(validator.safeParse(structuredClone(value)), {
              success: true,
              data: value,
            });
          for (const value of rejected)
            assert.equal(validator.safeParse(value).success, false, JSON.stringify(value));
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

type Codec = Readonly<{ decode: (value: unknown) => unknown; encode: (value: unknown) => unknown }>;
const isCodec = (value: unknown): value is Codec =>
  isRecord(value) && typeof value["decode"] === "function" && typeof value["encode"] === "function";

for (const runtimeMode of ["inline", "shared"] as const)
  void test(`recursive exact validators preserve bidirectional codecs in ${runtimeMode} mode`, async () => {
    const directory = createTemporaryDirectory({
      prefix: "consumer-codec-",
      rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
    });
    try {
      await generateSchemaFixture(
        directory,
        { $ref: nodeUri },
        {
          runtimeMode,
          declarationExportMode: "all",
          pluginOptions: { externalSchemas: { [nodeUri]: nodeSchema, [textUri]: textSchema } },
          transforms: [
            {
              kind: "map-properties",
              options: { keys: { kind: "case", decodedCase: "camelCase" } },
            },
          ],
          consumerSource: [
            'import { fixtureSchema } from "./generated";',
            'import type { z } from "zod/v4";',
            "type Input = z.input<typeof fixtureSchema>;",
            "type Output = z.output<typeof fixtureSchema>;",
            "type Assert<T extends true> = T;",
            'export const input: Input = { value_name: "root", child: { value_name: "leaf" } };',
            'export const output: Output = { valueName: "root", child: { valueName: "leaf" } };',
            'export type EncodedKeys = Assert<"valueName" extends keyof Input ? false : true>;',
            'export type DecodedKeys = Assert<"value_name" extends keyof Output ? false : true>;',
            "export type RejectsWrongField = Assert<{ valueName: number } extends Output ? false : true>;",
            "export const decode = (value: Input) => fixtureSchema.decode(value);",
            "export const encode = (value: Output) => fixtureSchema.encode(value);",
          ].join("\n"),
        },
      );
      const codec = await importGeneratedExport(
        nodePath.join(directory, "generated.ts"),
        "fixtureSchema",
        isCodec,
      );
      const encoded = { value_name: "root", child: { value_name: "leaf" } };
      const decoded = { valueName: "root", child: { valueName: "leaf" } };
      assert.deepEqual(codec.decode(encoded), decoded);
      assert.deepEqual(codec.encode(decoded), encoded);
      assert.deepEqual(codec.encode(codec.decode(encoded)), encoded);
      assert.throws(() => codec.decode({ value_name: "root", child: { value_name: "" } }));
      assert.throws(() => codec.encode({ valueName: "root", child: { valueName: "" } }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
