import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";

import type { JsonValue } from "type-fest";
import { z } from "zod/v4";

import { jsonSchemaDialectSchema, jsonSchemaValueSchema } from "../../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../../src";

export type OfficialSuiteCase = Readonly<{ data: JsonValue; description: string; valid: boolean }>;
export type OfficialSuiteGroup = Readonly<{
  description: string;
  schema: JsonSchemaValue;
  tests: readonly OfficialSuiteCase[];
}>;
export type OfficialSuiteGroups = readonly OfficialSuiteGroup[];
export type DialectInventory = Readonly<{
  caseInventorySha256: string;
  dialect: JsonSchemaDialect;
  directory: string;
  fileCount: number;
  groupCount: number;
  testCount: number;
}>;
export type RequiredInventory = Readonly<{
  caseInventorySha256: string;
  dialects: readonly DialectInventory[];
  testCount: number;
}>;
export type InventoryManifest = Readonly<{
  required: RequiredInventory;
  suite: Readonly<{ archiveSha256: string; archiveUrl: string; commit: string }>;
  version: 1;
}>;
export type OfficialSuiteDialect = Readonly<{ dialect: JsonSchemaDialect; directory: string }>;

export const fixtureDirectory: string = nodePath.join(
  import.meta.dirname,
  "../fixtures/json-schema-test-suite",
);
const suiteDirectory = nodePath.join(fixtureDirectory, "suite");
export const suiteRemotesDirectory: string = nodePath.join(suiteDirectory, "remotes");
const suiteTestsDirectory = nodePath.join(suiteDirectory, "tests");
export const inventoryManifestFile: string = nodePath.join(
  fixtureDirectory,
  "official-suite-inventory.json",
);

export const officialSuiteDialects: readonly OfficialSuiteDialect[] = [
  { dialect: "draft-7", directory: "draft7" },
  { dialect: "draft-2019-09", directory: "draft2019-09" },
  { dialect: "draft-2020-12", directory: "draft2020-12" },
] as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const countSchema = z.number().int().nonnegative();
const officialSuiteCaseSchema: z.ZodType<OfficialSuiteCase> = z.object({
  data: z.json(),
  description: z.string(),
  valid: z.boolean(),
});
const officialSuiteGroupSchema: z.ZodType<OfficialSuiteGroup> = z.object({
  description: z.string(),
  schema: jsonSchemaValueSchema,
  tests: z.array(officialSuiteCaseSchema),
});
const officialSuiteFileSchema: z.ZodType<OfficialSuiteGroups> = z.array(officialSuiteGroupSchema);
type AssertOfficialSuiteGroups = (value: unknown) => asserts value is OfficialSuiteGroups;
const assertOfficialSuiteGroups: AssertOfficialSuiteGroups = (value) => {
  officialSuiteFileSchema.parse(value);
};
const dialectInventorySchema: z.ZodType<DialectInventory> = z
  .object({
    caseInventorySha256: sha256Schema,
    dialect: jsonSchemaDialectSchema,
    directory: z.string().min(1),
    fileCount: countSchema,
    groupCount: countSchema,
    testCount: countSchema,
  })
  .strict();
const requiredInventorySchema: z.ZodType<RequiredInventory> = z
  .object({
    caseInventorySha256: sha256Schema,
    dialects: z.array(dialectInventorySchema),
    testCount: countSchema,
  })
  .strict();
export const inventoryManifestSchema: z.ZodType<InventoryManifest> = z
  .object({
    required: requiredInventorySchema,
    suite: z
      .object({
        archiveSha256: sha256Schema,
        archiveUrl: z.url(),
        commit: z.string().regex(/^[0-9a-f]{40}$/u),
      })
      .strict(),
    version: z.literal(1),
  })
  .strict();

export type SuiteGroupLocation = Readonly<{
  dialect: JsonSchemaDialect;
  file: string;
  groupIndex: number;
}>;
export type SuiteCaseLocation = SuiteGroupLocation & Readonly<{ testIndex: number }>;
export type SelectedGroup = SuiteGroupLocation & Readonly<{ group: OfficialSuiteGroup }>;
export type ScannedDialect = Readonly<{ caseIds: readonly string[]; inventory: DialectInventory }>;

export const parseJsonFile = async <TValue>(
  file: string,
  schema: z.ZodType<TValue>,
): Promise<TValue> => schema.parse(JSON.parse(await readFile(file, "utf8")));

export const hashCaseInventory = (caseIds: readonly string[]): string =>
  createHash("sha256")
    .update(`${caseIds.join("\n")}\n`)
    .digest("hex");

export const groupId = ({ dialect, file, groupIndex }: SuiteGroupLocation): string =>
  `${dialect}:${file}:${groupIndex.toString()}`;

export const caseId = ({ testIndex, ...group }: SuiteCaseLocation): string =>
  `${groupId(group)}:${testIndex.toString()}`;

export const selectedCaseId = (selected: SelectedGroup, testIndex: number): string =>
  caseId({
    dialect: selected.dialect,
    file: selected.file,
    groupIndex: selected.groupIndex,
    testIndex,
  });

export const dialectDirectory = (dialect: JsonSchemaDialect): string => {
  const entry = officialSuiteDialects.find((candidate) => candidate.dialect === dialect);
  if (entry === undefined) throw new Error(`Missing official suite directory for ${dialect}`);
  return entry.directory;
};

export const suiteFile = (dialect: JsonSchemaDialect, file: string): string =>
  nodePath.join(suiteTestsDirectory, dialectDirectory(dialect), file);

export const listSuiteFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(nodePath.join(suiteTestsDirectory, directory), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .toSorted();
};

export const readSuiteFile = async (
  dialect: JsonSchemaDialect,
  file: string,
): Promise<OfficialSuiteGroups> => {
  const groups: unknown = JSON.parse(await readFile(suiteFile(dialect, file), "utf8"));
  assertOfficialSuiteGroups(groups);
  // Preserve the official JSON graph because a validator clone can lose own `__proto__` keys.
  return groups;
};

export const loadRequiredGroups = async (): Promise<readonly SelectedGroup[]> => {
  const dialectGroups = await Promise.all(
    officialSuiteDialects.map(async ({ dialect, directory }) => {
      const files = await listSuiteFiles(directory);
      const fileGroups = await Promise.all(
        files.map(async (file) => ({ file, groups: await readSuiteFile(dialect, file) })),
      );
      return fileGroups.flatMap(({ file, groups }) =>
        groups.map((group, groupIndex): SelectedGroup => ({ dialect, file, group, groupIndex })),
      );
    }),
  );
  return dialectGroups.flat();
};

export const selectedCaseIds = (groups: readonly SelectedGroup[]): readonly string[] =>
  groups.flatMap((selected) =>
    Array.from(selected.group.tests.keys(), (testIndex) => selectedCaseId(selected, testIndex)),
  );

export const describeSuiteId = (
  groups: readonly SelectedGroup[],
  id: string,
): string | undefined => {
  const selected = groups.find((candidate) => {
    const candidateId = groupId(candidate);
    return id === candidateId || id.startsWith(`${candidateId}:`);
  });
  if (selected === undefined) return undefined;

  const selectedGroupId = groupId(selected);
  const groupDescription = `group ${JSON.stringify(selected.group.description)}`;
  if (id === selectedGroupId) return groupDescription;
  const testIndexText = id.slice(selectedGroupId.length + 1);
  if (!/^\d+$/u.test(testIndexText)) return undefined;
  const suiteCase = selected.group.tests[Number(testIndexText)];
  return suiteCase === undefined
    ? undefined
    : `${groupDescription}; case ${JSON.stringify(suiteCase.description)}`;
};

export const scanDialect = async (
  dialect: JsonSchemaDialect,
  directory: string,
): Promise<ScannedDialect> => {
  const files = await listSuiteFiles(directory);
  const suiteFiles = await Promise.all(
    files.map(async (file) => ({ file, groups: await readSuiteFile(dialect, file) })),
  );
  const caseIds: string[] = [];
  let groupCount = 0;

  for (const { file, groups } of suiteFiles) {
    groupCount += groups.length;
    for (const [groupIndex, group] of groups.entries())
      for (const testIndex of group.tests.keys())
        caseIds.push(caseId({ dialect, file, groupIndex, testIndex }));
  }

  return {
    caseIds,
    inventory: {
      caseInventorySha256: hashCaseInventory(caseIds),
      dialect,
      directory,
      fileCount: files.length,
      groupCount,
      testCount: caseIds.length,
    },
  };
};

export const scanRequiredInventory = async (): Promise<RequiredInventory> => {
  const scanned = await Promise.all(
    officialSuiteDialects.map(async ({ dialect, directory }) => {
      const result = await scanDialect(dialect, directory);
      return result;
    }),
  );
  const caseIds = scanned.flatMap((entry) => entry.caseIds);
  return {
    caseInventorySha256: hashCaseInventory(caseIds),
    dialects: scanned.map((entry) => entry.inventory),
    testCount: caseIds.length,
  };
};
