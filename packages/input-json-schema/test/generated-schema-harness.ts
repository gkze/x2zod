import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonSchemaValue } from "../src";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const printerHelperEntryPoint = nodePath.join(import.meta.dirname, "runtime-print-helper.ts");
const generatedSchemaExport = "runtimeCaseSchema";
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;

type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;

type GeneratedSchemaFixture = Readonly<{ generatedSchema: RuntimeZodSchema; source: string }>;

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

export const compileGeneratedSchema = async (
  schema: JsonSchemaValue,
): Promise<GeneratedSchemaFixture> => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-json-schema-generated-",
    rootDirectory: tempRootDirectory,
  });
  const bundleFile = nodePath.join(directory, "runtime-print-helper.mjs");
  const generatedFile = nodePath.join(directory, "generated.ts");
  const schemaFile = nodePath.join(directory, "schema.json");

  try {
    await writeFile(schemaFile, JSON.stringify(schema));
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: printerHelperEntryPoint,
      externals: jsonSchemaNativePreviewExternals,
      outfile: bundleFile,
    });
    const source = runNode({
      allowedStderr: isNativePreviewShutdownStderr,
      args: [bundleFile, schemaFile],
      cwd: packageRootDirectory,
    });
    await writeFile(generatedFile, source);
    const generatedSchema = await importGeneratedExport(
      generatedFile,
      generatedSchemaExport,
      isRuntimeZodSchema,
    );

    return { generatedSchema, source };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};
