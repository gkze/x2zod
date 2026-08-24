import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import { z } from "zod/v4";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import { jsonSchemaDialectSchema, jsonSchemaValueSchema } from "../src";
import type { JsonSchemaDialect } from "../src";
import {
  createOfficialSuiteValidator,
  diagnosticIdentitySchema,
  gapContractDiff,
  loadOfficialSuiteExternalSchemas,
  observedGap,
  runtimeGap,
} from "./official-suite-conformance-support";
import type {
  DiagnosticIdentity,
  GapContract,
  ObservedGap,
  OfficialSuiteExternalSchemas,
  RuntimeZodSchema,
} from "./official-suite-conformance-support";

const fixtureDirectory = nodePath.join(import.meta.dirname, "fixtures/json-schema-test-suite");
const suiteDirectory = nodePath.join(fixtureDirectory, "suite");
const suiteRemotesDirectory = nodePath.join(suiteDirectory, "remotes");
const suiteTestsDirectory = nodePath.join(suiteDirectory, "tests");
const inventoryManifestFile = nodePath.join(fixtureDirectory, "official-suite-inventory.json");
const shardManifestFile = nodePath.join(fixtureDirectory, "official-suite-shard.json");
const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const printerHelperEntryPoint = nodePath.join(
  import.meta.dirname,
  "official-suite-print-helper.ts",
);
const generatedSchemaExport = "officialSuiteCaseSchema";
const typeScriptBinary = nodePath.resolve(packageRootDirectory, "../../node_modules/.bin/tsgo");
const officialSuiteNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;

const officialSuiteDialects = [
  { dialect: "draft-7", directory: "draft7" },
  { dialect: "draft-2019-09", directory: "draft2019-09" },
  { dialect: "draft-2020-12", directory: "draft2020-12" },
] as const satisfies readonly Readonly<{ dialect: JsonSchemaDialect; directory: string }>[];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const countSchema = z.number().int().nonnegative();
const officialSuiteCaseSchema = z.object({
  data: z.json(),
  description: z.string(),
  valid: z.boolean(),
});
const officialSuiteGroupSchema = z.object({
  description: z.string(),
  schema: jsonSchemaValueSchema,
  tests: z.array(officialSuiteCaseSchema),
});
const officialSuiteFileSchema = z.array(officialSuiteGroupSchema);
const inventoryManifestSchema = z.object({
  suite: z
    .object({
      archiveSha256: sha256Schema,
      archiveUrl: z.url(),
      commit: z.string().regex(/^[0-9a-f]{40}$/u),
    })
    .strict(),
  version: z.literal(1),
});
const shardGroupSchema = z
  .object({
    dialect: jsonSchemaDialectSchema,
    file: z.string().regex(/^[^/]+\.json$/u),
    groupIndexes: z.array(countSchema).min(1),
  })
  .strict();
const expectedCompileWaiverSchema = z
  .object({ diagnostics: z.array(diagnosticIdentitySchema).min(1), reason: z.string().min(1) })
  .strict();
const expectedCompileGapSchema = z
  .object({ id: z.string().min(1), phase: z.literal("compile"), waiver: z.string().min(1) })
  .strict();
const expectedRuntimeGapSchema = z
  .object({
    codes: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    phase: z.literal("runtime"),
  })
  .strict();
const expectedGapSchema = z.discriminatedUnion("phase", [
  expectedCompileGapSchema,
  expectedRuntimeGapSchema,
]);
const shardManifestSchema = z
  .object({
    caseCount: countSchema,
    caseInventorySha256: sha256Schema,
    expectedCompileWaivers: z.record(z.string().min(1), expectedCompileWaiverSchema),
    expectedGaps: z.array(expectedGapSchema),
    groups: z.array(shardGroupSchema).min(1),
    suiteCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    version: z.literal(1),
  })
  .strict();
const printResultSchema = z.discriminatedUnion("ok", [
  z.object({ diagnostics: z.array(diagnosticIdentitySchema), ok: z.literal(false) }).strict(),
  z.object({ ok: z.literal(true), source: z.string() }).strict(),
]);

type OfficialSuiteGroup = z.infer<typeof officialSuiteGroupSchema>;
type ShardManifest = z.infer<typeof shardManifestSchema>;

type SelectedGroup = Readonly<{
  dialect: JsonSchemaDialect;
  file: string;
  group: OfficialSuiteGroup;
  groupIndex: number;
}>;
type SuiteCaseLocation = Readonly<{
  dialect: JsonSchemaDialect;
  file: string;
  groupIndex: number;
  testIndex: number;
}>;
type RunSelectedGroupResult = Readonly<{
  gaps: readonly ObservedGap[];
  generatedFile: string | undefined;
}>;
type RunSelectedGroupRequest = Readonly<{
  bundleFile: string;
  directory: string;
  externalSchemas: OfficialSuiteExternalSchemas;
  externalSchemasFile: string;
  index: number;
  selected: SelectedGroup;
}>;
const parseJsonFile = async <TValue>(file: string, schema: z.ZodType<TValue>): Promise<TValue> =>
  schema.parse(JSON.parse(await readFile(file, "utf8")));

const hashCaseInventory = (caseIds: readonly string[]): string =>
  createHash("sha256")
    .update(`${caseIds.join("\n")}\n`)
    .digest("hex");

const caseId = ({ dialect, file, groupIndex, testIndex }: SuiteCaseLocation): string =>
  `${dialect}:${file}:${groupIndex.toString()}:${testIndex.toString()}`;

const selectedCaseId = (selected: SelectedGroup, testIndex: number): string =>
  caseId({
    dialect: selected.dialect,
    file: selected.file,
    groupIndex: selected.groupIndex,
    testIndex,
  });

const dialectDirectory = (dialect: JsonSchemaDialect): string => {
  const entry = officialSuiteDialects.find((candidate) => candidate.dialect === dialect);
  if (entry === undefined) throw new Error(`Missing official suite directory for ${dialect}`);
  return entry.directory;
};

const suiteFile = (dialect: JsonSchemaDialect, file: string): string =>
  nodePath.join(suiteTestsDirectory, dialectDirectory(dialect), file);

const readSuiteFile = async (
  dialect: JsonSchemaDialect,
  file: string,
): Promise<OfficialSuiteGroup[]> => {
  const groups = await parseJsonFile(suiteFile(dialect, file), officialSuiteFileSchema);
  return groups;
};

const loadSelectedGroups = async (manifest: ShardManifest): Promise<readonly SelectedGroup[]> => {
  const selections = await Promise.all(
    manifest.groups.map(async (selection): Promise<readonly SelectedGroup[]> => {
      const groups = await readSuiteFile(selection.dialect, selection.file);
      return selection.groupIndexes.map((groupIndex): SelectedGroup => {
        const group = groups[groupIndex];
        if (group === undefined)
          throw new Error(
            `Official suite group ${selection.dialect}:${selection.file}:${groupIndex.toString()} does not exist`,
          );
        return { dialect: selection.dialect, file: selection.file, group, groupIndex };
      });
    }),
  );
  return selections.flat();
};

const selectedCaseIds = (groups: readonly SelectedGroup[]): readonly string[] =>
  groups.flatMap((selected) =>
    Array.from(selected.group.tests.keys(), (testIndex) => selectedCaseId(selected, testIndex)),
  );

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const compilationGaps = (
  selected: SelectedGroup,
  diagnostics: readonly DiagnosticIdentity[],
  detail: string,
): readonly ObservedGap[] =>
  Array.from(selected.group.tests.keys(), (testIndex) =>
    observedGap({ detail, diagnostics, id: selectedCaseId(selected, testIndex), phase: "compile" }),
  );

const assertAjvMatchesOfficialExpected = (
  selected: SelectedGroup,
  externalSchemas: OfficialSuiteExternalSchemas,
): void => {
  const validate = createOfficialSuiteValidator(
    selected.dialect,
    selected.group.schema,
    externalSchemas,
  );
  for (const suiteCase of selected.group.tests) {
    const fixtureBaseline = structuredClone(suiteCase.data);
    const validationInput = structuredClone(suiteCase.data);
    const validationResult = validate(validationInput);
    assert.deepEqual(
      validationInput,
      fixtureBaseline,
      `${selected.dialect}:${selected.file}:${selected.groupIndex.toString()} Ajv mutated its ` +
        `validation input for ${suiteCase.description}`,
    );
    assert.deepEqual(
      suiteCase.data,
      fixtureBaseline,
      `${selected.dialect}:${selected.file}:${selected.groupIndex.toString()} fixture data changed ` +
        `while Ajv evaluated ${suiteCase.description}`,
    );
    assert.equal(
      validationResult,
      suiteCase.valid,
      `${selected.dialect}:${selected.file}:${selected.groupIndex.toString()} Ajv disagreed with ` +
        `official expected result for ${suiteCase.description}: ${JSON.stringify(validate.errors)}`,
    );
  }
};

const runSelectedGroup = async ({
  bundleFile,
  directory,
  externalSchemas,
  externalSchemasFile,
  index,
  selected,
}: RunSelectedGroupRequest): Promise<RunSelectedGroupResult> => {
  assertAjvMatchesOfficialExpected(selected, externalSchemas);
  const schemaFile = nodePath.join(directory, `schema-${index.toString()}.json`);
  const generatedFile = nodePath.join(directory, `generated-${index.toString()}.ts`);
  await writeFile(schemaFile, JSON.stringify(selected.group.schema));
  const printed = printResultSchema.parse(
    JSON.parse(
      runNode({
        allowedStderr: isNativePreviewShutdownStderr,
        args: [bundleFile, schemaFile, selected.dialect, externalSchemasFile],
        cwd: packageRootDirectory,
      }),
    ),
  );

  if (!printed.ok) {
    const diagnosticSummary = printed.diagnostics
      .map(
        ({ code, message, pointer, severity }) =>
          `${severity} ${code} at ${pointer ?? "<none>"}: ${message}`,
      )
      .join("; ");
    return {
      gaps: compilationGaps(selected, printed.diagnostics, diagnosticSummary),
      generatedFile: undefined,
    };
  }

  await writeFile(generatedFile, printed.source);
  const generatedSchema = await importGeneratedExport(
    generatedFile,
    generatedSchemaExport,
    isRuntimeZodSchema,
  );
  const gaps = selected.group.tests
    .map((suiteCase, testIndex) =>
      runtimeGap({
        data: suiteCase.data,
        expectedValid: suiteCase.valid,
        id: selectedCaseId(selected, testIndex),
        schema: generatedSchema,
      }),
    )
    .filter((gap) => gap !== undefined);
  return { gaps, generatedFile };
};

const emitGeneratedDeclarations = (
  generatedFiles: readonly string[],
  outputDirectory: string,
): void => {
  if (generatedFiles.length === 0) return;

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
      ...generatedFiles,
    ],
    { cwd: packageRootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
};

void test("runs the focused official-suite shard through generated Zod", async () => {
  const inventoryManifest = await parseJsonFile(inventoryManifestFile, inventoryManifestSchema);
  const shardManifest = await parseJsonFile(shardManifestFile, shardManifestSchema);
  assert.equal(shardManifest.suiteCommit, inventoryManifest.suite.commit);
  const externalSchemas = await loadOfficialSuiteExternalSchemas(suiteRemotesDirectory);

  const groups = await loadSelectedGroups(shardManifest);
  const selectedIds = selectedCaseIds(groups);
  assert.equal(selectedIds.length, shardManifest.caseCount);
  assert.equal(hashCaseInventory(selectedIds), shardManifest.caseInventorySha256);
  assert.equal(new Set(selectedIds).size, selectedIds.length, "Shard selections must be unique");
  const selectedIdSet = new Set(selectedIds);
  const expectedIds = shardManifest.expectedGaps.map((gap) => gap.id);
  assert.equal(new Set(expectedIds).size, expectedIds.length, "Expected gap ids must be unique");
  for (const expectedId of expectedIds)
    assert.equal(selectedIdSet.has(expectedId), true, `Unknown expected gap id ${expectedId}`);
  const referencedCompileWaivers = new Set(
    shardManifest.expectedGaps.flatMap((gap) => (gap.phase === "compile" ? [gap.waiver] : [])),
  );
  for (const waiver of referencedCompileWaivers)
    assert.ok(
      shardManifest.expectedCompileWaivers[waiver] !== undefined,
      `Unknown expected compile waiver ${waiver}`,
    );
  assert.deepEqual(
    [...referencedCompileWaivers].toSorted(),
    Object.keys(shardManifest.expectedCompileWaivers).toSorted(),
    "Expected compile waivers must all be referenced",
  );

  const directory = createTemporaryDirectory({
    prefix: "x2zod-json-schema-official-suite-",
    rootDirectory: tempRootDirectory,
  });
  const bundleFile = nodePath.join(directory, "official-suite-print-helper.mjs");
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
    const results = await Promise.all(
      groups.map(async (selected, index) => {
        const result = await runSelectedGroup({
          bundleFile,
          directory,
          externalSchemas,
          externalSchemasFile,
          index,
          selected,
        });
        return result;
      }),
    );
    const gaps = results.flatMap((result) => result.gaps);
    const generatedFiles = results.flatMap((result) =>
      result.generatedFile === undefined ? [] : [result.generatedFile],
    );
    emitGeneratedDeclarations(generatedFiles, declarationDirectory);

    assert.equal(
      new Set(gaps.map((gap) => gap.id)).size,
      gaps.length,
      "Observed gaps must be unique",
    );
    const expectedContracts = shardManifest.expectedGaps.map((gap): GapContract => {
      if (gap.phase === "runtime") return { codes: gap.codes, id: gap.id, phase: gap.phase };
      const waiver = shardManifest.expectedCompileWaivers[gap.waiver];
      assert.ok(waiver !== undefined);
      return { diagnostics: waiver.diagnostics, id: gap.id, phase: gap.phase };
    });
    const difference = gapContractDiff(gaps, expectedContracts);
    assert.deepEqual(
      difference,
      { missing: [], unexpected: [] },
      `Official-suite gap manifest drift:\n${JSON.stringify({ difference, gaps }, null, 2)}`,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
