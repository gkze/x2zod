import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

import AjvDraft7 from "ajv";
import type { Options, ValidateFunction } from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";

import { buildInputs } from "@x2zod/build-inputs";
import type { Diagnostic, InputDocument } from "@x2zod/core";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import {
  jsonSchemaInputPlugin,
  jsonSchemaInputPluginOptionsSchema,
  jsonSchemaValueSchema,
} from "../src";
import type { JsonSchemaInputPluginOptions, JsonSchemaInputPluginOptionsInput } from "../src";
import { targetMatrix } from "./target-matrix";
import type {
  BlockedTarget,
  GeneratedZodTarget,
  SchemaUnavailableTarget,
  TargetFixtureSource,
  TargetMatrixEntry,
} from "./target-matrix";

const testDirectory = import.meta.dirname;
const packageRootDirectory = nodePath.resolve(testDirectory, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-json-schema-targets-";
const targetFixtureDirectory = nodePath.join(testDirectory, "fixtures/targets");
const printerHelperEntryPoint = nodePath.join(testDirectory, "target-print-helper.ts");
const bundledPrinterFileName = "target-print-helper.mjs";
const generatedModuleFileName = "target.generated.ts";
const optionsFileName = "plugin-options.json";
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;
const lastArrayItemOffset = 1;
const ajvOptions = { allErrors: true, logger: false, strict: false } satisfies Options;
const typeScriptBinary = nodePath.resolve(packageRootDirectory, "../../node_modules/.bin/tsgo");

type TargetZodParseResult = Readonly<{ success: boolean }>;
type TargetZodSchema = Readonly<{ safeParse: (value: unknown) => TargetZodParseResult }>;
type TargetRuntimeSample = Readonly<{ label: string; value: unknown }>;
type RuntimeSampleParityRequest = Readonly<{
  ajvValidate: ValidateFunction;
  expected: boolean;
  sample: TargetRuntimeSample;
  target: GeneratedZodTarget;
  zodSchema: TargetZodSchema;
}>;
type PrintTargetSourceRequest = Readonly<{
  bundleFile: string;
  optionsFile: string;
  schemaFile: string;
  typeName: string;
}>;

type DiagnosticReport = Readonly<{
  diagnostics: readonly Diagnostic[];
  phase: "lower" | "prepare";
}>;

type BuildInputProvenance = Readonly<{ id: string; path: string; url: string }>;

const targetFixture = (fileName: string): string => nodePath.join(targetFixtureDirectory, fileName);

const isTargetZodSchema = (value: unknown): value is TargetZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const isGeneratedZodTarget = (target: TargetMatrixEntry): target is GeneratedZodTarget =>
  target.roundTripLevel === "generated-zod";

const isBlockedTarget = (target: TargetMatrixEntry): target is BlockedTarget =>
  target.roundTripLevel === "blocked-schema-features";

const isSchemaUnavailableTarget = (target: TargetMatrixEntry): target is SchemaUnavailableTarget =>
  target.roundTripLevel === "schema-unavailable";

const isFixtureBackedTarget = (
  target: TargetMatrixEntry,
): target is BlockedTarget | GeneratedZodTarget =>
  target.roundTripLevel === "blocked-schema-features" || target.roundTripLevel === "generated-zod";

const buildPrinterBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: packageRootDirectory,
    entryPoint: printerHelperEntryPoint,
    externals: jsonSchemaNativePreviewExternals,
    outfile: bundleFile,
  });
};

const printTargetSource = ({
  bundleFile,
  optionsFile,
  schemaFile,
  typeName,
}: PrintTargetSourceRequest): string =>
  runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [bundleFile, schemaFile, typeName, optionsFile],
    cwd: packageRootDirectory,
  });

const emitGeneratedDeclarations = (generatedFile: string, outputDirectory: string): void => {
  const result = spawnSync(
    typeScriptBinary,
    [
      "--declaration",
      "--emitDeclarationOnly",
      "--ignoreConfig",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--outDir",
      outputDirectory,
      "--skipLibCheck",
      "--strict",
      "--target",
      "es2022",
      generatedFile,
    ],
    { cwd: packageRootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
};

const targetDocument = (schemaFile: string): InputDocument => ({
  source: { kind: "file", path: schemaFile },
  text: readFileSync(schemaFile, "utf8"),
});

const targetSchemaFile = (target: TargetFixtureSource): string =>
  targetFixture(target.schemaFileName);

const options = (input: JsonSchemaInputPluginOptionsInput): JsonSchemaInputPluginOptions =>
  jsonSchemaInputPluginOptionsSchema.parse(input);

const diagnosticReportFor = async (target: BlockedTarget): Promise<DiagnosticReport> => {
  const pluginOptions = options(target.pluginOptions);
  const prepared = await jsonSchemaInputPlugin.prepare(
    targetDocument(targetSchemaFile(target)),
    pluginOptions,
  );
  if (!prepared.ok) return { diagnostics: prepared.diagnostics, phase: "prepare" };

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  return { diagnostics: lowered.diagnostics ?? [], phase: "lower" };
};

const decodePointerSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

const diagnosticKeyword = (diagnostic: Diagnostic): string | undefined => {
  const segment = diagnostic.location?.pointer.split("/").at(-lastArrayItemOffset);
  return segment === undefined || segment === "" ? undefined : decodePointerSegment(segment);
};

const uniqueSortedStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted();

const diagnosticCodes = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  uniqueSortedStrings(diagnostics.map((diagnostic) => diagnostic.code));

const diagnosticKeywords = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  uniqueSortedStrings(
    diagnostics
      .map((diagnostic) => diagnosticKeyword(diagnostic))
      .filter((keyword) => keyword !== undefined),
  );

const buildInputProvenance = (target: TargetFixtureSource): BuildInputProvenance => ({
  id: String(target.buildInputId),
  path: target.schemaFileName,
  url: target.sourceUrl,
});

const compareBuildInputProvenance = (
  left: BuildInputProvenance,
  right: BuildInputProvenance,
): number => left.id.localeCompare(right.id);

const targetBuildInputs = (): readonly BuildInputProvenance[] =>
  targetMatrix
    .filter((target): target is BlockedTarget | GeneratedZodTarget => isFixtureBackedTarget(target))
    .map((target) => buildInputProvenance(target))
    .toSorted(compareBuildInputProvenance);

const resultBuildInputs = async (): Promise<readonly BuildInputProvenance[]> => {
  const result = await buildInputs({ mode: "check", rootDir: targetFixtureDirectory });
  assert.equal(result.lockfileUpdated, false);
  return result.inputs
    .map(
      (input): BuildInputProvenance => ({ id: String(input.id), path: input.path, url: input.url }),
    )
    .toSorted(compareBuildInputProvenance);
};

const targetAjvValidator = (target: GeneratedZodTarget): ValidateFunction => {
  const schema = jsonSchemaValueSchema.parse(
    JSON.parse(readFileSync(targetSchemaFile(target), "utf8")),
  );
  const dialect = target.pluginOptions.dialect ?? "draft-2020-12";
  if (dialect === "draft-7") return new AjvDraft7(ajvOptions).compile(schema);
  if (dialect === "draft-2019-09") return new AjvDraft2019(ajvOptions).compile(schema);
  return new AjvDraft2020(ajvOptions).compile(schema);
};

const assertRuntimeSampleParity = ({
  ajvValidate,
  expected,
  sample,
  target,
  zodSchema,
}: RuntimeSampleParityRequest): void => {
  const ajvAccepted = ajvValidate(sample.value);
  assert.equal(
    ajvAccepted,
    expected,
    `${target.name} Ajv result disagreed for ${sample.label}: ${JSON.stringify(ajvValidate.errors)}`,
  );
  assert.equal(
    zodSchema.safeParse(sample.value).success,
    ajvAccepted,
    `${target.name} generated Zod disagreed with Ajv for ${sample.label}`,
  );
};

const assertGeneratedTarget = async (target: GeneratedZodTarget): Promise<void> => {
  const directory = createTemporaryDirectory({
    prefix: tempDirectoryPrefix,
    rootDirectory: tempRootDirectory,
  });
  const bundleFile = nodePath.join(directory, bundledPrinterFileName);
  const generatedFile = nodePath.join(directory, generatedModuleFileName);
  const declarationDirectory = nodePath.join(directory, "declarations");
  const optionsFile = nodePath.join(directory, optionsFileName);

  try {
    await writeFile(optionsFile, JSON.stringify(target.pluginOptions));
    buildPrinterBundle(bundleFile);
    await writeFile(
      generatedFile,
      printTargetSource({
        bundleFile,
        optionsFile,
        schemaFile: targetSchemaFile(target),
        typeName: target.typeName,
      }),
    );
    emitGeneratedDeclarations(generatedFile, declarationDirectory);

    const zodSchema = await importGeneratedExport(
      generatedFile,
      target.exportName,
      isTargetZodSchema,
    );
    const ajvValidate = targetAjvValidator(target);
    for (const validSample of target.validSamples)
      assertRuntimeSampleParity({
        ajvValidate,
        expected: true,
        sample: validSample,
        target,
        zodSchema,
      });
    for (const invalidSample of target.invalidSamples)
      assertRuntimeSampleParity({
        ajvValidate,
        expected: false,
        sample: invalidSample,
        target,
        zodSchema,
      });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

void describe("JSON Schema public target E2E matrix", () => {
  void test("locks fixture provenance with build-inputs", async () => {
    assert.deepEqual(await resultBuildInputs(), targetBuildInputs());
  });

  for (const target of targetMatrix.filter((candidate): candidate is GeneratedZodTarget =>
    isGeneratedZodTarget(candidate),
  ))
    void test(
      [target.name, "emits Zod declarations with Ajv runtime parity"].join(" "),
      async () => {
        await assertGeneratedTarget(target);
      },
    );

  for (const target of targetMatrix.filter((candidate): candidate is BlockedTarget =>
    isBlockedTarget(candidate),
  ))
    void test(
      [target.name, "reports its current exact blocking schema features"].join(" "),
      async () => {
        const report = await diagnosticReportFor(target);

        assert.equal(report.phase, target.expectedPhase);
        assert.deepEqual(
          diagnosticCodes(report.diagnostics),
          uniqueSortedStrings(target.expectedCodes),
        );
        assert.deepEqual(
          diagnosticKeywords(report.diagnostics),
          uniqueSortedStrings(target.expectedKeywords),
        );
      },
    );

  void test("tracks discussed targets without stable public schema fixtures", () => {
    const schemaUnavailableTargets = targetMatrix.filter(
      (target): target is SchemaUnavailableTarget => isSchemaUnavailableTarget(target),
    );

    assert.deepEqual(
      schemaUnavailableTargets.map((target) => target.name),
      ["Visual Studio Code settings", "Zed settings"],
    );
    assert.equal(
      schemaUnavailableTargets.every((target) => target.reason.length > 0),
      true,
    );
  });

  void test("records the current round-trip level for every discussed target", () => {
    assert.deepEqual(
      targetMatrix.map((target) => ({ name: target.name, roundTripLevel: target.roundTripLevel })),
      [
        { name: "OpenCode config", roundTripLevel: "dedicated-product-e2e" },
        { name: "Conductor user settings", roundTripLevel: "generated-zod" },
        { name: "Conductor repo settings", roundTripLevel: "generated-zod" },
        { name: "Codex config", roundTripLevel: "generated-zod" },
        { name: "Claude Code settings", roundTripLevel: "blocked-schema-features" },
        { name: "Mise config", roundTripLevel: "generated-zod" },
        { name: "Cursor environment", roundTripLevel: "generated-zod" },
        { name: "Visual Studio Code settings", roundTripLevel: "schema-unavailable" },
        { name: "Zed settings", roundTripLevel: "schema-unavailable" },
      ],
    );
  });
});
