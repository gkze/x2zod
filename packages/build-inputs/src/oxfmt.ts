import { spawnSync } from "node:child_process";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const oxfmtBinaryName = process.platform === "win32" ? "oxfmt.cmd" : "oxfmt";

const oxfmtBinary = (): string =>
  Bun.which("oxfmt") ?? path.join(repositoryRoot, "node_modules/.bin", oxfmtBinaryName);

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
