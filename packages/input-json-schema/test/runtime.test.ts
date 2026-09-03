import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { compileGeneratedSchema } from "./generated-schema-harness";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const typeScriptBinary = nodePath.resolve(packageRootDirectory, "../../node_modules/.bin/tsgo");
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

const testUnicodePattern = async (): Promise<void> => {
  const { generatedSchema, source } = await compileGeneratedSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    pattern: "^\\p{Letter}+$",
    type: "string",
  });

  assert.ok(source.includes(String.raw`new RegExp("^\\p{Letter}+$", "u")`));

  for (const value of ["Hello", "π"]) {
    const result = generatedSchema.safeParse(value);
    assert.equal(result.success, true);
    assert.equal(result.data, value);
  }
  assert.equal(generatedSchema.safeParse("123").success, false);

  const directory = createTemporaryDirectory({
    prefix: tempDirectoryPrefix,
    rootDirectory: packageRootDirectory,
  });
  const generatedFile = nodePath.join(directory, generatedModuleFileName);
  const probeFile = nodePath.join(directory, "type-probe.ts");

  try {
    await writeFile(generatedFile, source);
    await writeFile(
      probeFile,
      [
        'import type { RuntimeCase } from "./json-schema-runtime.generated.js";',
        "type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>",
        "  Value extends Right ? 1 : 2 ? true : false;",
        "type Assert<Value extends true> = Value;",
        "export type RuntimeCaseIsString = Assert<Equal<RuntimeCase, string>>;",
      ].join("\n"),
    );
    const result = spawnSync(
      typeScriptBinary,
      [
        "--ignoreConfig",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--skipLibCheck",
        "--strict",
        "--target",
        "es2022",
        "--noEmit",
        generatedFile,
        probeFile,
      ],
      { cwd: packageRootDirectory, encoding: "utf8" },
    );
    assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

void test(
  "uses Unicode semantics for patterns without changing inferred string types",
  testUnicodePattern,
);

void describe("JSON Schema generated runtime source", () => {
  void test("enforces unevaluatedItems after Draft 2020-12 prefixItems", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      prefixItems: [{ type: "string" }],
      type: "array",
      unevaluatedItems: false,
    });

    assert.deepEqual(
      [...source.matchAll(/^import\s+.*?from\s+["'](?<module>[^"']+)["'];$/gmu)].map(
        (match) => match[1],
      ),
      ["zod/v4"],
    );
    assert.equal(generatedSchema.safeParse(["ok"]).success, true);
    assert.equal(generatedSchema.safeParse(["ok", 1]).success, false);
  });

  void test("supports Draft 2020-12 dynamic recursion", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema({
      $id: "https://example.com/tree.schema.json",
      $dynamicAnchor: "node",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {
        children: { items: { $dynamicRef: "#node" }, type: "array" },
        value: { type: "string" },
      },
      required: ["value"],
      type: "object",
    });

    assert.deepEqual(
      [...source.matchAll(/^import\s+.*?from\s+["'](?<module>[^"']+)["'];$/gmu)].map(
        (match) => match[1],
      ),
      ["zod/v4"],
    );
    assert.equal(
      generatedSchema.safeParse({
        children: [{ children: [{ value: "leaf" }], value: "branch" }],
        value: "root",
      }).success,
      true,
    );
    assert.equal(
      generatedSchema.safeParse({ children: [{ value: 42 }], value: "root" }).success,
      false,
    );
  });

  void test("supports Draft 2019-09 recursive scope", async () => {
    const { generatedSchema, source } = await compileGeneratedSchema(
      {
        $recursiveAnchor: true,
        $schema: "https://json-schema.org/draft/2019-09/schema",
        properties: {
          children: { items: { $recursiveRef: "#" }, type: "array" },
          value: { type: "string" },
        },
        required: ["value"],
        type: "object",
      },
      { dialect: "draft-2019-09" },
    );

    assert.deepEqual(
      [...source.matchAll(/^import\s+.*?from\s+["'](?<module>[^"']+)["'];$/gmu)].map(
        (match) => match[1],
      ),
      ["zod/v4"],
    );
    assert.equal(
      generatedSchema.safeParse({
        children: [{ children: [{ value: "leaf" }], value: "branch" }],
        value: "root",
      }).success,
      true,
    );
    assert.equal(
      generatedSchema.safeParse({ children: [{ value: 42 }], value: "root" }).success,
      false,
    );
  });
});

void describe("JSON Schema generated runtime fixtures", () => {
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
