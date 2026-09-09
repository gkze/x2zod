import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { performance } from "node:perf_hooks";

import type { DeclarationExportMode, RuntimeMode, ZodEmissionTransformInput } from "@x2zod/core";

import { checkGeneratedConsumer, checkGeneratedTypeScript } from "../../../test/generated-consumer";
import {
  buildNodeBundle,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";

type ParseResult = Readonly<{ success: false }> | Readonly<{ success: true; data: unknown }>;
export type FixtureValidator = Readonly<{ safeParse: (value: unknown) => ParseResult }>;
export type FixtureMetrics = Readonly<{
  sourceBytes: number;
  compileMs: number;
  declarationsMs: number;
}>;
const packageDirectory = nodePath.resolve(import.meta.dirname, "..");
const compilerDeadlineMs = 60_000;
const declarationDeadlineMs = 15_000;
export const isFixtureValidator = (value: unknown): value is FixtureValidator =>
  isRecord(value) && typeof value["safeParse"] === "function";

// Compile through the public API in Node, emit declarations, and import the generated module.
export const generateSchemaFixture = async (
  directory: string,
  schema: JsonSchemaValue,
  request: Readonly<{
    pluginOptions?: JsonSchemaInputPluginOptionsInput | undefined;
    consumerSource?: string;
    runtimeMode?: RuntimeMode;
    declarationExportMode?: DeclarationExportMode;
    transforms?: readonly ZodEmissionTransformInput[];
    onMetrics?: (metrics: FixtureMetrics) => void;
  }> = {},
): Promise<FixtureValidator> => {
  const { pluginOptions = {}, consumerSource } = request;
  const schemaFile = nodePath.join(directory, "schema.json");
  const optionsFile = nodePath.join(directory, "options.json");
  const bundleFile = nodePath.join(directory, "printer.mjs");
  const generatedFile = nodePath.join(directory, "generated.ts");
  await Promise.all([
    writeFile(schemaFile, JSON.stringify(schema)),
    writeFile(optionsFile, JSON.stringify(pluginOptions)),
  ]);
  buildNodeBundle({
    cwd: packageDirectory,
    entryPoint: nodePath.join(import.meta.dirname, "target-print-helper.ts"),
    externals: [...nativePreviewExternals, "jsonc-parser"],
    outfile: bundleFile,
  });
  const compileStart = performance.now();
  const source = runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [
      bundleFile,
      schemaFile,
      "Fixture",
      optionsFile,
      request.runtimeMode ?? "inline",
      request.declarationExportMode ?? "root",
      JSON.stringify(request.transforms ?? []),
    ],
    cwd: packageDirectory,
    timeoutMs: compilerDeadlineMs,
  });
  const compileMs = performance.now() - compileStart;
  await writeFile(generatedFile, source);
  const consumerFile = nodePath.join(directory, "consumer.ts");
  const outputDirectory = nodePath.join(directory, "declarations");
  const declarationsStart = performance.now();
  const compiler = { cwd: packageDirectory, outputDirectory, timeoutMs: declarationDeadlineMs };
  if (consumerSource === undefined)
    checkGeneratedTypeScript({ ...compiler, files: [generatedFile] });
  else
    await checkGeneratedConsumer({
      ...compiler,
      generatedFiles: [generatedFile],
      consumerFile,
      consumerSource,
    });
  request.onMetrics?.({
    sourceBytes: Buffer.byteLength(source),
    compileMs,
    declarationsMs: performance.now() - declarationsStart,
  });
  return importGeneratedExport(generatedFile, "fixtureSchema", isFixtureValidator);
};
