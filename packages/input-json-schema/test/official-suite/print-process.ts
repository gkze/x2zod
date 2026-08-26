import { readFileSync } from "node:fs";

import { isNativePreviewShutdownStderr, runNode } from "../../../../test/native-source-harness";
import {
  officialSuitePrintBatchResultSchema,
  officialSuitePrintProgressSchema,
} from "./print-contract";
import type { OfficialSuitePrintBatchResult, OfficialSuitePrintProgress } from "./print-contract";

type RunOfficialSuitePrintProcessRequest = Readonly<{
  batchFile: string;
  bundleFile: string;
  cwd: string;
  describeId: (id: string) => string | undefined;
  externalSchemasFile: string;
  failureContext: string;
  progressFile: string;
  timeoutMs: number;
}>;

const readProgress = (progressFile: string): OfficialSuitePrintProgress | undefined => {
  try {
    return officialSuitePrintProgressSchema.parse(
      JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
    );
  } catch {
    return undefined;
  }
};

const describeProgress = (
  progress: OfficialSuitePrintProgress | undefined,
  describeId: (id: string) => string | undefined,
): string => {
  if (progress === undefined) return "Active compiler phase was not recorded.";
  const phase = progress.phase === "compile" ? "schema compilation" : "generated-source emit";
  const description = describeId(progress.id);
  return `Active ${phase}: ${progress.id}${description === undefined ? "" : ` (${description})`}`;
};

export const runOfficialSuitePrintProcess = ({
  batchFile,
  bundleFile,
  cwd,
  describeId,
  externalSchemasFile,
  failureContext,
  progressFile,
  timeoutMs,
}: RunOfficialSuitePrintProcessRequest): OfficialSuitePrintBatchResult => {
  try {
    return officialSuitePrintBatchResultSchema.parse(
      JSON.parse(
        runNode({
          allowedStderr: isNativePreviewShutdownStderr,
          args: [bundleFile, batchFile, externalSchemasFile, progressFile],
          cwd,
          timeoutMs,
        }),
      ) as unknown,
    );
  } catch (error) {
    const progress = readProgress(progressFile);
    throw new Error(
      `Official-suite compiler batch failed for:\n${failureContext}\n${describeProgress(progress, describeId)}`,
      { cause: error },
    );
  }
};
