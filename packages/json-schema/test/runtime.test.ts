import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonObject, JsonSchemaValue } from "../src";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-json-schema-runtime-";
const printerHelperEntryPoint = nodePath.join(import.meta.dirname, "runtime-print-helper.ts");
const bundledPrinterFileName = "runtime-print-helper.mjs";
const schemaFileName = "schema.json";
const externalSchemaFileName = "external-schema.json";
const generatedModuleFileName = "json-schema-runtime.generated.ts";
const generatedSchemaExport = "runtimeCaseSchema";
const externalSchemaRef = "https://example.com/model.schema.json#/$defs/model";
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;

type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const buildPrinterBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: packageRootDirectory,
    entryPoint: printerHelperEntryPoint,
    externals: jsonSchemaNativePreviewExternals,
    outfile: bundleFile,
  });
};

const importGeneratedSchema = async (generatedFile: string): Promise<RuntimeZodSchema> => {
  const schema = await importGeneratedExport(
    generatedFile,
    generatedSchemaExport,
    isRuntimeZodSchema,
  );
  return schema;
};

const printRuntimeFixture = (
  bundleFile: string,
  schemaFile: string,
  externalSchemaFile?: string,
): string =>
  runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [
      bundleFile,
      schemaFile,
      ...(externalSchemaFile === undefined ? [] : [externalSchemaFile]),
    ],
    cwd: packageRootDirectory,
  });

const runtimeFixtureSchema = (): JsonSchemaValue => ({
  properties: {
    pair: {
      maxItems: 2,
      minItems: 2,
      prefixItems: [{ type: "string" }, { type: "number" }],
      type: "array",
    },
    slug: { pattern: "^[a-z]+$", type: "string" },
    tags: { items: { type: "string" }, maxItems: 3, minItems: 1, type: "array" },
    value: {},
  },
  required: ["value", "metadata"],
  type: "object",
});

const writeRuntimeFixtureSchema = async (schemaFile: string): Promise<void> => {
  await writeFile(schemaFile, JSON.stringify(runtimeFixtureSchema()));
};

const writeExternalReferenceFixture = async (
  schemaFile: string,
  externalSchemaFile: string,
): Promise<void> => {
  await writeFile(
    schemaFile,
    JSON.stringify({
      properties: { model: { $ref: externalSchemaRef } },
      required: ["model"],
      type: "object",
    }),
  );
  await writeFile(
    externalSchemaFile,
    JSON.stringify({ $defs: { model: { enum: ["alpha/model", "beta/model"] } } }),
  );
};

const validRuntimeValue = (): JsonObject => ({
  metadata: { source: "additional-properties" },
  pair: ["left", 2],
  slug: "abc",
  tags: ["tag"],
  value: "required-unknown",
});

void describe("JSON Schema generated runtime source", () => {
  void test("preserves required unknown keys, array bounds, patterns, and fixed tuples", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = nodePath.join(directory, bundledPrinterFileName);
    const schemaFile = nodePath.join(directory, schemaFileName);
    const generatedFile = nodePath.join(directory, generatedModuleFileName);

    try {
      await writeRuntimeFixtureSchema(schemaFile);
      buildPrinterBundle(bundleFile);
      const printedSource = printRuntimeFixture(bundleFile, schemaFile);
      assert.ok(printedSource.includes(".required({ value: true, metadata: true })"));
      assert.ok(printedSource.includes(".min(1).max(3)"));
      assert.ok(printedSource.includes("new RegExp"));
      assert.ok(printedSource.includes("z.tuple"));

      await writeFile(generatedFile, printedSource);
      const schema = await importGeneratedSchema(generatedFile);

      assert.equal(schema.safeParse(validRuntimeValue()).success, true);
      assert.equal(schema.safeParse({ ...validRuntimeValue(), slug: "ABC" }).success, false);
      assert.equal(schema.safeParse({ ...validRuntimeValue(), tags: [] }).success, false);
      assert.equal(
        schema.safeParse({ ...validRuntimeValue(), tags: ["a", "b", "c", "d"] }).success,
        false,
      );
      assert.equal(schema.safeParse({ ...validRuntimeValue(), pair: ["left"] }).success, false);
      assert.equal(
        schema.safeParse({ ...validRuntimeValue(), pair: ["left", 2, true] }).success,
        false,
      );
      assert.equal(
        schema.safeParse({
          metadata: validRuntimeValue()["metadata"],
          tags: validRuntimeValue()["tags"],
        }).success,
        false,
      );
      assert.equal(
        schema.safeParse({ tags: validRuntimeValue()["tags"], value: validRuntimeValue()["value"] })
          .success,
        false,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  void test("preserves referenced external schema declarations at runtime", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = nodePath.join(directory, bundledPrinterFileName);
    const schemaFile = nodePath.join(directory, schemaFileName);
    const externalSchemaFile = nodePath.join(directory, externalSchemaFileName);
    const generatedFile = nodePath.join(directory, generatedModuleFileName);

    try {
      await writeExternalReferenceFixture(schemaFile, externalSchemaFile);
      buildPrinterBundle(bundleFile);
      const printedSource = printRuntimeFixture(bundleFile, schemaFile, externalSchemaFile);

      assert.ok(printedSource.includes("z.enum"));
      assert.ok(printedSource.includes("modelSchema"));

      await writeFile(generatedFile, printedSource);
      const schema = await importGeneratedSchema(generatedFile);

      assert.equal(schema.safeParse({ model: "alpha/model" }).success, true);
      assert.equal(schema.safeParse({ model: "gamma/model" }).success, false);
      assert.equal(schema.safeParse({}).success, false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
