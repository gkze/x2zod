import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  nativePreviewExternals,
} from "../../../../test/native-source-harness";
import { buildOfficialSuiteBaseline } from "./baseline";
import type { ObservedCompileGap, OfficialSuiteBaseline, OracleGap } from "./baseline";
import {
  createOfficialSuiteValidator,
  loadOfficialSuiteExternalSchemas,
} from "./conformance-support";
import type { OfficialSuiteExternalSchemas } from "./conformance-support";
import {
  describeSuiteId,
  groupId,
  hashCaseInventory,
  inventoryManifestFile,
  inventoryManifestSchema,
  loadRequiredGroups,
  parseJsonFile,
  selectedCaseId,
  selectedCaseIds,
  suiteRemotesDirectory,
} from "./fixture-support";
import type { SelectedGroup } from "./fixture-support";
import { officialSuitePrintBatchSchema } from "./print-contract";
import type { OfficialSuitePrintBatchResult, OfficialSuitePrintResult } from "./print-contract";
import { runOfficialSuitePrintProcess } from "./print-process";
import { officialSuiteRuntimeBatchSchema } from "./runtime-contract";
import type {
  OfficialSuiteRuntimeBatchResult,
  OfficialSuiteRuntimeGroupRequest,
  RuntimeGapContract,
} from "./runtime-contract";
import { runOfficialSuiteRuntimeProcess } from "./runtime-process";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "../..");
const tempRootDirectory = nodePath.join(packageRootDirectory, ".cache");
const printerHelperEntryPoint = nodePath.join(import.meta.dirname, "print-helper.ts");
const runtimeHelperEntryPoint = nodePath.join(import.meta.dirname, "runtime-helper.ts");
const typeScriptBinary = nodePath.resolve(packageRootDirectory, "../../node_modules/.bin/tsgo");
const officialSuiteNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;
const officialSuiteRuntimeExternals = ["zod/v4"] as const;
const compilerBatchSize = 32;
const declarationBatchSize = 128;
const compilerBatchTimeoutMs = 60_000;
const declarationBatchTimeoutMs = 120_000;
const runtimeBatchTimeoutMs = 60_000;
const mebibyteInBytes = 1_048_576;
const subprocessMaxBufferMebibytes = 16;
const subprocessMaxBufferBytes = subprocessMaxBufferMebibytes * mebibyteInBytes;

type IndexedSelectedGroup = Readonly<{ index: number; selected: SelectedGroup }>;
type GeneratedFile = Readonly<{ file: string; selected: SelectedGroup }>;
type RunCompiledBatchRequest = Readonly<{
  batch: readonly IndexedSelectedGroup[];
  batchFile: string;
  bundleFile: string;
  directory: string;
  externalSchemasFile: string;
  printProgressFile: string;
  runtimeBatchFile: string;
  runtimeBundleFile: string;
  runtimeProgressFile: string;
}>;
type ProcessedPrintResult = Readonly<{
  compileGaps: readonly ObservedCompileGap[];
  generatedFiles: readonly GeneratedFile[];
}>;
type RunCompiledBatchResult = ProcessedPrintResult &
  Readonly<{ runtimeGaps: readonly RuntimeGapContract[] }>;
type RunGeneratedSchemasRequest = Readonly<{
  generatedFiles: readonly GeneratedFile[];
  runtimeBatchFile: string;
  runtimeBundleFile: string;
  runtimeProgressFile: string;
}>;

const mapSequentially = async <TValue extends object, TResult>(
  values: readonly TValue[],
  mapValue: (value: TValue, index: number) => Promise<TResult>,
  index = 0,
): Promise<readonly TResult[]> => {
  const value = values[index];
  if (value === undefined) return [];
  const result = await mapValue(value, index);
  const remaining = await mapSequentially(values, mapValue, index + 1);
  return [result, ...remaining];
};

const chunksOf = <TValue>(
  values: readonly TValue[],
  size: number,
): readonly (readonly TValue[])[] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_value, index) =>
    values.slice(index * size, (index + 1) * size),
  );

const selectedGroupLabel = (selected: SelectedGroup): string =>
  `${groupId(selected)} (group ${JSON.stringify(selected.group.description)})`;

const createOfficialSuiteValidatorOrUndefined = (
  selected: SelectedGroup,
  externalSchemas: OfficialSuiteExternalSchemas,
): ReturnType<typeof createOfficialSuiteValidator> | undefined => {
  try {
    return createOfficialSuiteValidator(selected.dialect, selected.group.schema, externalSchemas);
  } catch {
    return undefined;
  }
};

const collectAjvOracleGaps = (
  selected: SelectedGroup,
  externalSchemas: OfficialSuiteExternalSchemas,
): readonly OracleGap[] => {
  const validate = createOfficialSuiteValidatorOrUndefined(selected, externalSchemas);
  if (validate === undefined)
    return [{ code: "compile_exception", id: groupId(selected), phase: "compile" }];

  const gaps: OracleGap[] = [];
  for (const [testIndex, suiteCase] of selected.group.tests.entries()) {
    const id = selectedCaseId(selected, testIndex);
    const fixtureBaseline = structuredClone(suiteCase.data);
    const validationInput = structuredClone(suiteCase.data);
    let validationResult: boolean | Promise<unknown> | undefined = undefined;
    let validationFailed = false;
    try {
      validationResult = validate(validationInput);
    } catch {
      gaps.push({ code: "runtime_exception", id, phase: "runtime" });
      validationFailed = true;
    }
    if (!validationFailed) {
      if (!isDeepStrictEqual(validationInput, fixtureBaseline))
        gaps.push({ code: "input_mutation", id, phase: "runtime" });
      assert.deepEqual(
        suiteCase.data,
        fixtureBaseline,
        `${groupId(selected)} fixture data changed while Ajv evaluated ${suiteCase.description}`,
      );
      if (validationResult !== suiteCase.valid)
        gaps.push({ code: "validity_mismatch", id, phase: "runtime" });
    }
  }
  return gaps;
};

const processPrintedResult = async (
  selected: IndexedSelectedGroup,
  printed: OfficialSuitePrintResult,
  directory: string,
): Promise<ProcessedPrintResult> => {
  assert.equal(
    printed.id,
    groupId(selected.selected),
    `Official-suite compiler batch result order changed for ${selectedGroupLabel(selected.selected)}`,
  );
  if (!printed.ok)
    return {
      compileGaps: [{ diagnostics: printed.diagnostics, id: printed.id }],
      generatedFiles: [],
    };

  const generatedFile = nodePath.join(directory, `generated-${selected.index.toString()}.ts`);
  await writeFile(generatedFile, printed.source);
  return {
    compileGaps: [],
    generatedFiles: [{ file: generatedFile, selected: selected.selected }],
  };
};

const runtimeGroupRequest = ({
  file,
  selected,
}: GeneratedFile): OfficialSuiteRuntimeGroupRequest => ({
  cases: selected.group.tests.map((suiteCase, testIndex) => ({
    data: suiteCase.data,
    expectedValid: suiteCase.valid,
    id: selectedCaseId(selected, testIndex),
  })),
  generatedFile: file,
  id: groupId(selected),
});

const runGeneratedSchemas = async ({
  generatedFiles,
  runtimeBatchFile,
  runtimeBundleFile,
  runtimeProgressFile,
}: RunGeneratedSchemasRequest): Promise<readonly RuntimeGapContract[]> => {
  if (generatedFiles.length === 0) return [];

  const request = officialSuiteRuntimeBatchSchema.parse({
    groups: generatedFiles.map((generatedFile) => runtimeGroupRequest(generatedFile)),
  });
  await writeFile(runtimeBatchFile, JSON.stringify(request));
  const groupLabels = generatedFiles.map(({ selected }) => selectedGroupLabel(selected)).join("\n");
  const selectedGroups = generatedFiles.map(({ selected }) => selected);
  const result: OfficialSuiteRuntimeBatchResult = runOfficialSuiteRuntimeProcess({
    batchFile: runtimeBatchFile,
    bundleFile: runtimeBundleFile,
    cwd: packageRootDirectory,
    describeId: (id) => describeSuiteId(selectedGroups, id),
    failureContext: groupLabels,
    progressFile: runtimeProgressFile,
    timeoutMs: runtimeBatchTimeoutMs,
  });
  const expectedCaseIds = request.groups.flatMap((group) => group.cases.map(({ id }) => id));
  assert.deepEqual(
    result.results.map(({ id }) => id),
    expectedCaseIds,
    `Official-suite generated runtime batch omitted or reordered cases for:\n${groupLabels}`,
  );
  return result.results.flatMap((caseResult) =>
    caseResult.ok ? [] : [{ codes: caseResult.codes, id: caseResult.id, phase: caseResult.phase }],
  );
};

const runCompiledBatch = async ({
  batch,
  batchFile,
  bundleFile,
  directory,
  externalSchemasFile,
  printProgressFile,
  runtimeBatchFile,
  runtimeBundleFile,
  runtimeProgressFile,
}: RunCompiledBatchRequest): Promise<RunCompiledBatchResult> => {
  const request = officialSuitePrintBatchSchema.parse({
    requests: batch.map(({ selected }) => ({
      dialect: selected.dialect,
      id: groupId(selected),
      schema: selected.group.schema,
    })),
  });
  await writeFile(batchFile, JSON.stringify(request));
  const batchLabels = batch.map(({ selected }) => selectedGroupLabel(selected)).join("\n");
  const selectedGroups = batch.map(({ selected }) => selected);
  const printed: OfficialSuitePrintBatchResult = runOfficialSuitePrintProcess({
    batchFile,
    bundleFile,
    cwd: packageRootDirectory,
    describeId: (id) => describeSuiteId(selectedGroups, id),
    externalSchemasFile,
    failureContext: batchLabels,
    progressFile: printProgressFile,
    timeoutMs: compilerBatchTimeoutMs,
  });
  assert.equal(
    printed.results.length,
    batch.length,
    `Official-suite compiler batch omitted results for:\n${batchLabels}`,
  );
  const results = await Promise.all(
    printed.results.map(async (result, index) => {
      const selected = batch[index];
      assert.ok(selected !== undefined);
      const processed = await processPrintedResult(selected, result, directory);
      return processed;
    }),
  );
  const generatedFiles = results.flatMap((result) => result.generatedFiles);
  return {
    compileGaps: results.flatMap((result) => result.compileGaps),
    generatedFiles,
    runtimeGaps: await runGeneratedSchemas({
      generatedFiles,
      runtimeBatchFile,
      runtimeBundleFile,
      runtimeProgressFile,
    }),
  };
};

const emitGeneratedDeclarationBatch = (
  generatedFiles: readonly GeneratedFile[],
  outputDirectory: string,
): void => {
  const groupLabels = generatedFiles
    .map(({ file, selected }) => `${nodePath.basename(file)}: ${selectedGroupLabel(selected)}`)
    .join("\n");
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
      ...generatedFiles.map(({ file }) => file),
    ],
    {
      cwd: packageRootDirectory,
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: subprocessMaxBufferBytes,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: declarationBatchTimeoutMs,
    },
  );
  if (result.error !== undefined)
    throw new Error(`Official-suite declaration subprocess failed for:\n${groupLabels}`, {
      cause: result.error,
    });
  if (result.signal !== null)
    throw new Error(
      `Official-suite declaration subprocess for the following groups was terminated by ${result.signal}:\n${groupLabels}`,
    );
  assert.equal(
    result.status,
    0,
    `Official-suite declaration emit failed for:\n${groupLabels}\n${[result.stdout, result.stderr].join("\n")}`,
  );
};

const emitGeneratedDeclarations = (
  generatedFiles: readonly GeneratedFile[],
  outputDirectory: string,
): void => {
  for (const batch of chunksOf(generatedFiles, declarationBatchSize))
    emitGeneratedDeclarationBatch(batch, outputDirectory);
};

export const runOfficialSuiteConformance = async (): Promise<OfficialSuiteBaseline> => {
  const inventoryManifest = await parseJsonFile(inventoryManifestFile, inventoryManifestSchema);
  const groups = await loadRequiredGroups();
  const caseIds = selectedCaseIds(groups);
  assert.equal(caseIds.length, inventoryManifest.required.testCount);
  assert.equal(hashCaseInventory(caseIds), inventoryManifest.required.caseInventorySha256);
  assert.equal(new Set(caseIds).size, caseIds.length, "Required suite cases must be unique");

  const externalSchemas = await loadOfficialSuiteExternalSchemas(suiteRemotesDirectory);
  const oracleGaps = groups.flatMap((selected) => collectAjvOracleGaps(selected, externalSchemas));
  const directory = createTemporaryDirectory({
    prefix: ".tmp-x2zod-json-schema-official-suite-",
    rootDirectory: tempRootDirectory,
  });
  const bundleFile = nodePath.join(directory, "official-suite-print-helper.mjs");
  const runtimeBundleFile = nodePath.join(directory, "official-suite-runtime-helper.mjs");
  const declarationDirectory = nodePath.join(directory, "declarations");
  const externalSchemasFile = nodePath.join(directory, "external-schemas.json");

  try {
    await writeFile(externalSchemasFile, JSON.stringify(externalSchemas));
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: printerHelperEntryPoint,
      externals: officialSuiteNativePreviewExternals,
      outfile: bundleFile,
    });
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: runtimeHelperEntryPoint,
      externals: officialSuiteRuntimeExternals,
      outfile: runtimeBundleFile,
    });
    const indexedGroups = groups.map(
      (selected, index): IndexedSelectedGroup => ({ index, selected }),
    );
    const batchResults = await mapSequentially(
      chunksOf(indexedGroups, compilerBatchSize),
      async (batch, batchIndex) => {
        const result = await runCompiledBatch({
          batch,
          batchFile: nodePath.join(directory, `batch-${batchIndex.toString()}.json`),
          bundleFile,
          directory,
          externalSchemasFile,
          printProgressFile: nodePath.join(
            directory,
            `print-progress-${batchIndex.toString()}.json`,
          ),
          runtimeBatchFile: nodePath.join(directory, `runtime-batch-${batchIndex.toString()}.json`),
          runtimeBundleFile,
          runtimeProgressFile: nodePath.join(
            directory,
            `runtime-progress-${batchIndex.toString()}.json`,
          ),
        });
        return result;
      },
    );

    const generatedFiles = batchResults.flatMap((result) => result.generatedFiles);
    emitGeneratedDeclarations(generatedFiles, declarationDirectory);
    return buildOfficialSuiteBaseline({
      compileGaps: batchResults.flatMap((result) => result.compileGaps),
      groups,
      oracleGaps,
      runtimeGaps: batchResults.flatMap((result) => result.runtimeGaps),
      suiteCommit: inventoryManifest.suite.commit,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};
