import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SuppressionDirective {
  readonly line: number;
  readonly value: string;
}

interface FileSuppressionDirective extends SuppressionDirective {
  readonly filePath: string;
}

const excludedDirectoryNames: ReadonlySet<string> = new Set([
  ".cache",
  ".dex",
  ".direnv",
  ".git",
  ".publish-tmp",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const disable = "disable";
const ignore = "ignore";
const shellcheck = "shellcheck";
const suppressionPattern = new RegExp(
  [
    `(?:eslint|markdownlint|oxlint)-${disable}(?:-line|-next-line)?`,
    ["markdownlint", "configure", "file"].join("-"),
    `(?:oxfmt|prettier)-${ignore}`,
    `@ts-(?:${["expect", "error"].join("-")}|${ignore}|${["no", "check"].join("")})`,
    `${shellcheck} ${disable}`,
  ].join("|"),
  "gu",
);

const isExcludedDirectory = (directoryName: string): boolean =>
  excludedDirectoryNames.has(directoryName) || directoryName.startsWith(".tmp-x2zod-");

export const isScannableFile = (fileName: string): boolean =>
  fileName !== ".DS_Store" &&
  fileName !== "Thumbs.db" &&
  (fileName === ".envrc" || !fileName.startsWith(".env")) &&
  !fileName.endsWith(".log") &&
  !fileName.endsWith(".tsbuildinfo");

export const findSuppressionDirectives = (source: string): readonly SuppressionDirective[] =>
  [...source.matchAll(suppressionPattern)].map((match) => {
    const { index } = match;

    return { line: source.slice(0, index).split("\n").length, value: match.at(0) ?? "" };
  });

const findFilesRecursively = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedDirectories = entries
    .filter((entry) => entry.isDirectory() && !isExcludedDirectory(entry.name))
    .map((entry) => path.join(directory, entry.name));
  const nestedFiles = await Promise.all(
    nestedDirectories.map(async (nestedDirectory): Promise<readonly string[]> => {
      const files = await findFilesRecursively(nestedDirectory);

      return files;
    }),
  );
  const localFiles = entries
    .filter((entry) => entry.isFile() && isScannableFile(entry.name))
    .map((entry) => path.join(directory, entry.name));

  return [...localFiles, ...nestedFiles.flat()];
};

const scanFile = async (filePath: string): Promise<readonly FileSuppressionDirective[]> => {
  const source = await readFile(filePath, "utf8");

  return findSuppressionDirectives(source).map((directive) => ({
    filePath,
    line: directive.line,
    value: directive.value,
  }));
};

export const checkNoSuppressions = async (): Promise<void> => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const files = await findFilesRecursively(repositoryRoot);
  const fileFindings = await Promise.all(
    files.map(async (file): Promise<readonly FileSuppressionDirective[]> => {
      const findings = await scanFile(file);

      return findings;
    }),
  );
  const findings = fileFindings.flat();

  if (findings.length === 0) return;

  const messages = findings.map(
    ({ filePath, line, value }) =>
      `${path.relative(repositoryRoot, filePath)}:${line}: suppression directive ${value} is forbidden`,
  );

  throw new Error(messages.join("\n"));
};

if (import.meta.main) await checkNoSuppressions();
