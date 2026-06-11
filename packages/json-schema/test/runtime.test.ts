import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonObject, JsonSchemaValue } from "../src";

const packageRootDirectory = resolve(import.meta.dirname, "..");
const tempRootDirectory = join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-json-schema-runtime-";
const printerHelperEntryPoint = join(import.meta.dirname, "runtime-print-helper.ts");
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
  await Bun.write(schemaFile, JSON.stringify(runtimeFixtureSchema()));
};

const writeExternalReferenceFixture = async (
  schemaFile: string,
  externalSchemaFile: string,
): Promise<void> => {
  await Bun.write(
    schemaFile,
    JSON.stringify({
      properties: { model: { $ref: externalSchemaRef } },
      required: ["model"],
      type: "object",
    }),
  );
  await Bun.write(
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

describe("JSON Schema generated runtime source", () => {
  test("preserves required unknown keys, array bounds, patterns, and fixed tuples", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = join(directory, bundledPrinterFileName);
    const schemaFile = join(directory, schemaFileName);
    const generatedFile = join(directory, generatedModuleFileName);

    try {
      await writeRuntimeFixtureSchema(schemaFile);
      buildPrinterBundle(bundleFile);
      const printedSource = printRuntimeFixture(bundleFile, schemaFile);
      expect(printedSource).toContain(".required({ value: true, metadata: true })");
      expect(printedSource).toContain(".min(1).max(3)");
      expect(printedSource).toContain("new RegExp");
      expect(printedSource).toContain("z.tuple");

      await Bun.write(generatedFile, printedSource);
      const schema = await importGeneratedSchema(generatedFile);

      expect(schema.safeParse(validRuntimeValue()).success).toBe(true);
      expect(schema.safeParse({ ...validRuntimeValue(), slug: "ABC" }).success).toBe(false);
      expect(schema.safeParse({ ...validRuntimeValue(), tags: [] }).success).toBe(false);
      expect(schema.safeParse({ ...validRuntimeValue(), tags: ["a", "b", "c", "d"] }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...validRuntimeValue(), pair: ["left"] }).success).toBe(false);
      expect(schema.safeParse({ ...validRuntimeValue(), pair: ["left", 2, true] }).success).toBe(
        false,
      );
      expect(
        schema.safeParse({
          metadata: validRuntimeValue()["metadata"],
          tags: validRuntimeValue()["tags"],
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ tags: validRuntimeValue()["tags"], value: validRuntimeValue()["value"] })
          .success,
      ).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("preserves referenced external schema declarations at runtime", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = join(directory, bundledPrinterFileName);
    const schemaFile = join(directory, schemaFileName);
    const externalSchemaFile = join(directory, externalSchemaFileName);
    const generatedFile = join(directory, generatedModuleFileName);

    try {
      await writeExternalReferenceFixture(schemaFile, externalSchemaFile);
      buildPrinterBundle(bundleFile);
      const printedSource = printRuntimeFixture(bundleFile, schemaFile, externalSchemaFile);

      expect(printedSource).toContain("z.enum");
      expect(printedSource).toContain("modelSchema");

      await Bun.write(generatedFile, printedSource);
      const schema = await importGeneratedSchema(generatedFile);

      expect(schema.safeParse({ model: "alpha/model" }).success).toBe(true);
      expect(schema.safeParse({ model: "gamma/model" }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
