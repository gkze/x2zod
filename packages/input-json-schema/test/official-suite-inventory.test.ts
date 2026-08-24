import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import { z } from "zod/v4";

import { buildInputs } from "@x2zod/build-inputs";

import { jsonSchemaDialectSchema, jsonSchemaValueSchema } from "../src";
import type { JsonSchemaDialect } from "../src";

const fixtureDirectory = nodePath.join(import.meta.dirname, "fixtures/json-schema-test-suite");
const suiteTestsDirectory = nodePath.join(fixtureDirectory, "suite/tests");
const inventoryManifestFile = nodePath.join(fixtureDirectory, "official-suite-inventory.json");

const officialSuiteDialects = [
  { dialect: "draft-7", directory: "draft7" },
  { dialect: "draft-2019-09", directory: "draft2019-09" },
  { dialect: "draft-2020-12", directory: "draft2020-12" },
] as const satisfies readonly Readonly<{ dialect: JsonSchemaDialect; directory: string }>[];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const countSchema = z.number().int().nonnegative();
const officialSuiteFileSchema = z.array(
  z.object({
    description: z.string(),
    schema: jsonSchemaValueSchema,
    tests: z.array(z.object({ data: z.json(), description: z.string(), valid: z.boolean() })),
  }),
);
const dialectInventorySchema = z
  .object({
    caseInventorySha256: sha256Schema,
    dialect: jsonSchemaDialectSchema,
    directory: z.string().min(1),
    fileCount: countSchema,
    groupCount: countSchema,
    testCount: countSchema,
  })
  .strict();
const requiredInventorySchema = z
  .object({
    caseInventorySha256: sha256Schema,
    dialects: z.array(dialectInventorySchema),
    testCount: countSchema,
  })
  .strict();
const inventoryManifestSchema = z
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

type OfficialSuiteGroups = z.infer<typeof officialSuiteFileSchema>;
type RequiredInventory = z.infer<typeof requiredInventorySchema>;
type SuiteCaseLocation = Readonly<{
  dialect: JsonSchemaDialect;
  file: string;
  groupIndex: number;
  testIndex: number;
}>;
type ScannedDialect = Readonly<{
  caseIds: readonly string[];
  inventory: z.infer<typeof dialectInventorySchema>;
}>;

const parseJsonFile = async <TValue>(file: string, schema: z.ZodType<TValue>): Promise<TValue> => {
  const value = await readFile(file, "utf8");
  return schema.parse(JSON.parse(value));
};

const hashInventory = (caseIds: readonly string[]): string =>
  createHash("sha256")
    .update(`${caseIds.join("\n")}\n`)
    .digest("hex");

const caseId = ({ dialect, file, groupIndex, testIndex }: SuiteCaseLocation): string =>
  `${dialect}:${file}:${groupIndex.toString()}:${testIndex.toString()}`;

const readSuiteFile = async (directory: string, file: string): Promise<OfficialSuiteGroups> => {
  const groups = await parseJsonFile(
    nodePath.join(suiteTestsDirectory, directory, file),
    officialSuiteFileSchema,
  );
  return groups;
};

const scanDialect = async (
  dialect: JsonSchemaDialect,
  directory: string,
): Promise<ScannedDialect> => {
  const entries = await readdir(nodePath.join(suiteTestsDirectory, directory), {
    withFileTypes: true,
  });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .toSorted();
  const suiteFiles = await Promise.all(
    files.map(async (file) => ({ file, groups: await readSuiteFile(directory, file) })),
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
      caseInventorySha256: hashInventory(caseIds),
      dialect,
      directory,
      fileCount: files.length,
      groupCount,
      testCount: caseIds.length,
    },
  };
};

const scanRequiredInventory = async (): Promise<RequiredInventory> => {
  const scanned = await Promise.all(
    officialSuiteDialects.map(async ({ dialect, directory }) => {
      const result = await scanDialect(dialect, directory);
      return result;
    }),
  );
  const caseIds = scanned.flatMap((entry) => entry.caseIds);
  return {
    caseInventorySha256: hashInventory(caseIds),
    dialects: scanned.map((entry) => entry.inventory),
    testCount: caseIds.length,
  };
};

void test("pins and inventories the official required suite", async () => {
  const manifest = await parseJsonFile(inventoryManifestFile, inventoryManifestSchema);
  const result = await buildInputs({ mode: "check", rootDir: fixtureDirectory });
  assert.equal(result.lockfileUpdated, false);
  assert.equal(result.inputs.length, 1);
  const [input] = result.inputs;
  assert.ok(input !== undefined);
  assert.equal(input.type, "archive");
  assert.equal(input.url, manifest.suite.archiveUrl);
  assert.equal(input.sourceSha256, manifest.suite.archiveSha256);
  assert.deepEqual(await scanRequiredInventory(), manifest.required);
});
