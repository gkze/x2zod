import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { isRecord } from "../../../../test/structural";
import {
  officialSuiteRuntimeBatchResultSchema,
  officialSuiteRuntimeBatchSchema,
  officialSuiteRuntimeProgressSchema,
} from "./runtime-contract";
import type {
  OfficialSuiteRuntimeCaseResult,
  OfficialSuiteRuntimeGroupRequest,
  OfficialSuiteRuntimeProgress,
  RuntimeZodSchema,
} from "./runtime-contract";
import { runtimeGap } from "./runtime-support";

const batchPathArgumentIndex = 2;
const progressPathArgumentIndex = 3;
const generatedSchemaExport = "officialSuiteCaseSchema";

const batchPath = process.argv[batchPathArgumentIndex];
if (batchPath === undefined) throw new Error("Missing official suite runtime batch argument.");
const progressPath = process.argv[progressPathArgumentIndex];
if (progressPath === undefined)
  throw new Error("Missing official suite runtime progress argument.");
const batch = officialSuiteRuntimeBatchSchema.parse(
  JSON.parse(readFileSync(batchPath, "utf8")) as unknown,
);
const temporaryProgressPath = `${progressPath}.tmp`;

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const recordProgress = (progress: OfficialSuiteRuntimeProgress): void => {
  const serialized = JSON.stringify(officialSuiteRuntimeProgressSchema.parse(progress));
  writeFileSync(temporaryProgressPath, serialized);
  renameSync(temporaryProgressPath, progressPath);
};

const evaluateGroup = async (
  group: OfficialSuiteRuntimeGroupRequest,
): Promise<readonly OfficialSuiteRuntimeCaseResult[]> => {
  recordProgress({ id: group.id, phase: "module_import" });
  const imported: unknown = await import(pathToFileURL(group.generatedFile).href);
  if (!isRecord(imported)) throw new Error(`Generated module ${group.id} is not an object.`);
  const schema = imported[generatedSchemaExport];
  if (!isRuntimeZodSchema(schema))
    throw new Error(`Generated module ${group.id} is missing ${generatedSchemaExport}.`);
  return group.cases.map((suiteCase): OfficialSuiteRuntimeCaseResult => {
    recordProgress({ id: suiteCase.id, phase: "runtime" });
    const gap = runtimeGap({
      data: suiteCase.data,
      expectedValid: suiteCase.expectedValid,
      id: suiteCase.id,
      schema,
    });
    return gap === undefined
      ? { id: suiteCase.id, ok: true }
      : { codes: gap.codes, id: gap.id, ok: false, phase: gap.phase };
  });
};

const evaluateGroups = async (
  groups: readonly OfficialSuiteRuntimeGroupRequest[],
  index = 0,
): Promise<readonly OfficialSuiteRuntimeCaseResult[]> => {
  const group = groups[index];
  if (group === undefined) return [];
  const results = await evaluateGroup(group);
  const remaining = await evaluateGroups(groups, index + 1);
  return [...results, ...remaining];
};

const results = await evaluateGroups(batch.groups);

process.stdout.write(JSON.stringify(officialSuiteRuntimeBatchResultSchema.parse({ results })));
