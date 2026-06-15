import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const oxfmtBinaryName = process.platform === "win32" ? "oxfmt.cmd" : "oxfmt";

const pathExecutable = (binaryName: string): string | undefined =>
  process.env["PATH"]
    ?.split(path.delimiter)
    .map((directory) => path.join(directory, binaryName))
    .find((candidate) => existsSync(candidate));

const oxfmtBinary = (): string =>
  pathExecutable(oxfmtBinaryName) ??
  path.join(repositoryRoot, "node_modules/.bin", oxfmtBinaryName);

export const formatWithOxfmt = (content: string, filePath: string): string => {
  const result = spawnSync(oxfmtBinary(), ["--stdin-filepath", filePath], {
    encoding: "utf8",
    input: content,
  });

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `oxfmt exited with status ${String(result.status)}`);

  return result.stdout;
};
