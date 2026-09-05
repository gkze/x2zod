import { rmSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { DeclarationExportMode, ZodEmissionTransformInput } from "@x2zod/core";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonSchemaDialect, JsonSchemaInertKeywords, JsonSchemaValue } from "../src";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const printerHelperEntryPoint = nodePath.join(import.meta.dirname, "runtime-print-helper.ts");
const generatedSchemaExport = "runtimeCaseSchema";
const zodPackageDirectory = nodePath.dirname(
  fileURLToPath(import.meta.resolve("zod/package.json")),
);
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;

type RuntimeParseResult = Readonly<{ success: false }> | Readonly<{ data: unknown; success: true }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;

type GeneratedSchemaFixture = Readonly<{ generatedSchema: RuntimeZodSchema; source: string }>;

type IsolatedGeneratedSchemaFixture = Readonly<{
  acceptedValues: readonly unknown[];
  rejectedValues: readonly unknown[];
  source: string;
  timeoutMs?: number;
}>;

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

export const verifyGeneratedSchemaRuntimeIsolation = async ({
  acceptedValues,
  rejectedValues,
  source,
  timeoutMs,
}: IsolatedGeneratedSchemaFixture): Promise<void> => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-json-schema-isolated-",
    rootDirectory: tmpdir(),
  });
  const generatedFile = nodePath.join(directory, "generated.ts");
  const runnerFile = nodePath.join(directory, "runner.mjs");
  const nodeModulesDirectory = nodePath.join(directory, "node_modules");

  try {
    await mkdir(nodeModulesDirectory);
    await Promise.all([
      symlink(zodPackageDirectory, nodePath.join(nodeModulesDirectory, "zod"), "dir"),
      writeFile(generatedFile, source),
      writeFile(
        runnerFile,
        [
          'import { runtimeCaseSchema } from "./generated.ts";',
          "const acceptedValues = JSON.parse(process.argv[2]);",
          "const rejectedValues = JSON.parse(process.argv[3]);",
          "for (const value of acceptedValues)",
          '  if (!runtimeCaseSchema.safeParse(value).success) throw new Error("accepted");',
          "for (const value of rejectedValues)",
          '  if (runtimeCaseSchema.safeParse(value).success) throw new Error("rejected");',
          String.raw`process.stdout.write("ok\n");`,
        ].join("\n"),
      ),
    ]);
    const output = runNode({
      args: [runnerFile, JSON.stringify(acceptedValues), JSON.stringify(rejectedValues)],
      cwd: directory,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (output !== "ok\n") throw new Error("Generated schema isolation check failed.");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

export const compileGeneratedSchema = async (
  schema: JsonSchemaValue,
  options: Readonly<{
    dialect?: JsonSchemaDialect;
    declarationExportMode?: DeclarationExportMode;
    externalSchema?: JsonSchemaValue;
    externalSchemaRelativePath?: string;
    externalSchemaUri?: string;
    inertKeywords?: JsonSchemaInertKeywords;
    schemaExportName?: string;
    transforms?: readonly ZodEmissionTransformInput[];
  }> = {},
): Promise<GeneratedSchemaFixture> => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-json-schema-generated-",
    rootDirectory: tempRootDirectory,
  });
  const bundleFile = nodePath.join(directory, "runtime-print-helper.mjs");
  const generatedFile = nodePath.join(directory, "generated.ts");
  const schemaFile = nodePath.join(directory, "schema.json");
  const externalSchemaFile = nodePath.join(directory, "external-schema.json");

  try {
    await writeFile(schemaFile, JSON.stringify(schema));
    if (options.externalSchema !== undefined)
      await writeFile(externalSchemaFile, JSON.stringify(options.externalSchema));
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: printerHelperEntryPoint,
      externals: jsonSchemaNativePreviewExternals,
      outfile: bundleFile,
    });
    let optionalArguments: readonly string[] = [];
    if (options.dialect !== undefined)
      optionalArguments = [...optionalArguments, `--dialect=${options.dialect}`];
    if (options.declarationExportMode !== undefined)
      optionalArguments = [
        ...optionalArguments,
        `--declaration-export-mode=${options.declarationExportMode}`,
      ];
    if (options.inertKeywords !== undefined)
      optionalArguments = [
        ...optionalArguments,
        `--inert-keywords=${JSON.stringify(options.inertKeywords)}`,
      ];
    if (options.externalSchema !== undefined)
      optionalArguments = [...optionalArguments, externalSchemaFile];
    const externalSchemaUri =
      options.externalSchemaRelativePath === undefined
        ? options.externalSchemaUri
        : new URL(options.externalSchemaRelativePath, pathToFileURL(schemaFile)).href;
    if (externalSchemaUri !== undefined)
      optionalArguments = [...optionalArguments, `--external-schema-uri=${externalSchemaUri}`];
    if (options.transforms !== undefined && options.transforms.length > 0)
      optionalArguments = [...optionalArguments, "--map-properties"];
    const source = runNode({
      allowedStderr: isNativePreviewShutdownStderr,
      args: [bundleFile, schemaFile, ...optionalArguments],
      cwd: packageRootDirectory,
    });
    await writeFile(generatedFile, source);
    const generatedSchema = await importGeneratedExport(
      generatedFile,
      options.schemaExportName ?? generatedSchemaExport,
      isRuntimeZodSchema,
    );

    return { generatedSchema, source };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};
