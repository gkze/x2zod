import { readFileSync } from "node:fs";

import { runNode } from "../../../../test/native-source-harness";
import {
  officialSuiteRuntimeBatchResultSchema,
  officialSuiteRuntimeProgressSchema,
} from "./runtime-contract";
import type {
  OfficialSuiteRuntimeBatchResult,
  OfficialSuiteRuntimeProgress,
} from "./runtime-contract";

type RunOfficialSuiteRuntimeProcessRequest = Readonly<{
  batchFile: string;
  bundleFile: string;
  cwd: string;
  describeId: (id: string) => string | undefined;
  failureContext: string;
  progressFile: string;
  timeoutMs: number;
}>;

const readProgress = (progressFile: string): OfficialSuiteRuntimeProgress | undefined => {
  try {
    return officialSuiteRuntimeProgressSchema.parse(
      JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
    );
  } catch {
    return undefined;
  }
};

const describeProgress = (
  progress: OfficialSuiteRuntimeProgress | undefined,
  describeId: (id: string) => string | undefined,
): string => {
  if (progress === undefined) return "Active generated-runtime phase was not recorded.";
  const phase =
    progress.phase === "module_import" ? "generated-module import" : "runtime validation";
  const description = describeId(progress.id);
  return `Active ${phase}: ${progress.id}${description === undefined ? "" : ` (${description})`}`;
};

export const runOfficialSuiteRuntimeProcess = ({
  batchFile,
  bundleFile,
  cwd,
  describeId,
  failureContext,
  progressFile,
  timeoutMs,
}: RunOfficialSuiteRuntimeProcessRequest): OfficialSuiteRuntimeBatchResult => {
  try {
    return officialSuiteRuntimeBatchResultSchema.parse(
      JSON.parse(
        runNode({ args: [bundleFile, batchFile, progressFile], cwd, timeoutMs }),
      ) as unknown,
    );
  } catch (error) {
    const progress = readProgress(progressFile);
    throw new Error(
      `Official-suite generated runtime batch failed for:\n${failureContext}\n${describeProgress(progress, describeId)}`,
      { cause: error },
    );
  }
};
