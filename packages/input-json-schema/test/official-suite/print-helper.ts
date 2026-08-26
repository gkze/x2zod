import { readFileSync, renameSync, writeFileSync } from "node:fs";

import type { SourceFile } from "@typescript/native-preview/unstable/ast";

import { compileToZodSource } from "@x2zod/core";
import type { Diagnostic } from "@x2zod/core";

import { printNativeSourceFiles, requiredArgument } from "../../../../test/native-print-helper";
import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../../src";
import type { DiagnosticIdentity } from "./diagnostic-contract";
import {
  officialSuitePrintBatchResultSchema,
  officialSuitePrintBatchSchema,
  officialSuitePrintProgressSchema,
} from "./print-contract";
import type { OfficialSuitePrintFailure, OfficialSuitePrintProgress } from "./print-contract";

const batchPathArgumentIndex = 2;
const externalSchemasPathArgumentIndex = 3;
const progressPathArgumentIndex = 4;
const officialSuiteTypeName = "OfficialSuiteCase";
type PendingResult =
  | OfficialSuitePrintFailure
  | Readonly<{ id: string; ok: true; sourceFile: SourceFile }>;

const mapSequentially = async <TValue extends object, TResult>(
  values: readonly TValue[],
  mapValue: (value: TValue) => Promise<TResult>,
  index = 0,
): Promise<readonly TResult[]> => {
  const value = values[index];
  if (value === undefined) return [];
  const result = await mapValue(value);
  const remaining = await mapSequentially(values, mapValue, index + 1);
  return [result, ...remaining];
};

const batchPath = requiredArgument(batchPathArgumentIndex, "JSON Schema suite batch");
const externalSchemasPath = requiredArgument(
  externalSchemasPathArgumentIndex,
  "JSON Schema external resources",
);
const progressPath = requiredArgument(
  progressPathArgumentIndex,
  "JSON Schema suite print progress",
);
const temporaryProgressPath = `${progressPath}.tmp`;
const printDiagnostic = ({
  code,
  location,
  message,
  severity,
}: Diagnostic): DiagnosticIdentity => ({
  code,
  message,
  pointer: location?.pointer ?? null,
  severity,
});
const batch = officialSuitePrintBatchSchema.parse(
  JSON.parse(readFileSync(batchPath, "utf8")) as unknown,
);
const requestIds = batch.requests.map(({ id }) => id);
if (new Set(requestIds).size !== requestIds.length)
  throw new Error("JSON Schema suite batch request ids must be unique.");
const externalSchemas = JSON.parse(readFileSync(externalSchemasPath, "utf8")) as unknown;
const recordProgress = (progress: OfficialSuitePrintProgress): void => {
  const serialized = JSON.stringify(officialSuitePrintProgressSchema.parse(progress));
  writeFileSync(temporaryProgressPath, serialized);
  renameSync(temporaryProgressPath, progressPath);
};
const pendingResults = await mapSequentially(
  batch.requests,
  async (request): Promise<PendingResult> => {
    recordProgress({ id: request.id, phase: "compile" });
    const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({
      dialect: request.dialect,
      externalSchemas,
      validator: "none",
    });
    const result = await compileToZodSource({
      document: {
        source: { kind: "file", path: request.id },
        text: JSON.stringify(request.schema),
      },
      output: { typeName: officialSuiteTypeName },
      plugin: jsonSchemaInputPlugin,
      pluginOptions,
    });

    if (result.ok) return { id: request.id, ok: true, sourceFile: result.value.sourceFile };
    const [firstDiagnostic, ...remainingDiagnostics] = result.diagnostics;
    const pendingResult: PendingResult = {
      diagnostics: [
        printDiagnostic(firstDiagnostic),
        ...remainingDiagnostics.map((diagnostic) => printDiagnostic(diagnostic)),
      ],
      id: request.id,
      ok: false,
    };
    return pendingResult;
  },
);

const printableResults = pendingResults.flatMap((result) =>
  result.ok ? [{ id: result.id, sourceFile: result.sourceFile }] : [],
);
const printedSources = printNativeSourceFiles({
  beforePrint: (index) => {
    const result = printableResults[index];
    if (result === undefined)
      throw new Error(`Missing printable result at index ${index.toString()}.`);
    recordProgress({ id: result.id, phase: "source_emit" });
  },
  sourceFiles: printableResults.map(({ sourceFile }) => sourceFile),
});
let printedSourceIndex = 0;
const results = pendingResults.map((result) => {
  if (!result.ok) return result;
  const source = printedSources[printedSourceIndex];
  printedSourceIndex += 1;
  if (source === undefined) throw new Error(`Native TypeScript emitter omitted ${result.id}.`);
  return { id: result.id, ok: true, source } as const;
});

process.stdout.write(JSON.stringify(officialSuitePrintBatchResultSchema.parse({ results })));
