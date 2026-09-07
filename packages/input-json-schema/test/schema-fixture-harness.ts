import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";

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
const packageDirectory = nodePath.resolve(import.meta.dirname, "..");
const typeScriptBinary = nodePath.resolve(packageDirectory, "../../node_modules/.bin/tsgo");
const compilerDeadlineMs = 60_000;
const declarationDeadlineMs = 15_000;
const isFixtureValidator = (value: unknown): value is FixtureValidator =>
  isRecord(value) && typeof value["safeParse"] === "function";

// Compile through the public API in Node, emit declarations, and import the generated module.
export const generateSchemaFixture = async (
  directory: string,
  schema: JsonSchemaValue,
  request: Readonly<{
    pluginOptions?: JsonSchemaInputPluginOptionsInput | undefined;
    consumerSource?: string;
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
  const source = runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [bundleFile, schemaFile, "Fixture", optionsFile],
    cwd: packageDirectory,
    timeoutMs: compilerDeadlineMs,
  });
  await writeFile(generatedFile, source);
  const consumerFile = nodePath.join(directory, "consumer.ts");
  if (consumerSource !== undefined) await writeFile(consumerFile, consumerSource);
  const declarations = spawnSync(
    typeScriptBinary,
    [
      "--declaration",
      "--emitDeclarationOnly",
      "--ignoreConfig",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--outDir",
      nodePath.join(directory, "declarations"),
      "--skipLibCheck",
      "--strict",
      "--target",
      "es2022",
      generatedFile,
      ...(consumerSource === undefined ? [] : [consumerFile]),
    ],
    { cwd: packageDirectory, encoding: "utf8", timeout: declarationDeadlineMs },
  );
  if (declarations.error !== undefined) throw declarations.error;
  assert.equal(declarations.status, 0, declarations.stdout + declarations.stderr);
  return importGeneratedExport(generatedFile, "fixtureSchema", isFixtureValidator);
};
