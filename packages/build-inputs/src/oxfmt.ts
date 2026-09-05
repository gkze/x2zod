import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const oxfmtEntrypoint = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("oxfmt/package.json"))),
  "bin",
  "oxfmt",
);

export const formatWithOxfmt = (content: string, filePath: string): string => {
  const result = spawnSync(process.execPath, [oxfmtEntrypoint, "--stdin-filepath", filePath], {
    encoding: "utf8",
    input: content,
  });

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `oxfmt exited with status ${String(result.status)}`);

  return result.stdout;
};
