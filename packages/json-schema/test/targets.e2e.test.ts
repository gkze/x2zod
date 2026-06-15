import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

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
import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
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

type TargetZodParseResult = Readonly<{ success: boolean }>;
type TargetZodSchema = Readonly<{ safeParse: (value: unknown) => TargetZodParseResult }>;
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

const assertInvalidSamplesFail = (target: GeneratedZodTarget, schema: TargetZodSchema): void => {
  for (const invalidSample of target.invalidSamples) {
    const parsed = schema.safeParse(invalidSample.value);
    if (parsed.success)
      throw new Error(`${target.name} accepted invalid sample: ${invalidSample.label}`);
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
      [target.name, "emits importable Zod source for a valid fixture"].join(" "),
      async () => {
        const directory = createTemporaryDirectory({
          prefix: tempDirectoryPrefix,
          rootDirectory: tempRootDirectory,
        });
        const bundleFile = nodePath.join(directory, bundledPrinterFileName);
        const generatedFile = nodePath.join(directory, generatedModuleFileName);
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

          const schema = await importGeneratedExport(
            generatedFile,
            target.exportName,
            isTargetZodSchema,
          );
          assert.equal(schema.safeParse(target.validSample.value).success, true);
          assertInvalidSamplesFail(target, schema);
        } finally {
          rmSync(directory, { force: true, recursive: true });
        }
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
        { name: "Cursor environment", roundTripLevel: "generated-zod" },
        { name: "Visual Studio Code settings", roundTripLevel: "schema-unavailable" },
        { name: "Zed settings", roundTripLevel: "schema-unavailable" },
      ],
    );
  });
});
