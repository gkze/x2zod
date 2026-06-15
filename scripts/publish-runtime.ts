import { spawnSync } from "node:child_process";
import { access as fsAccess, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { z } from "zod/v4";

export const jsrConfigFile = "jsr.json";
export const notFoundStatus = 404;
export const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
export const bunExecutable = process.env["BUN_EXE"] ?? "bun";
export const runningInGitHubActions = process.env["GITHUB_ACTIONS"] === "true";
export const jsonObjectSchema = z.record(z.string(), z.json()).readonly();
export const stringRecordSchema = z.record(z.string(), z.string()).readonly();

export type JsonObject = z.infer<typeof jsonObjectSchema>;

export const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

export const writeLine = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fsAccess(filePath);
    return true;
  } catch {
    return false;
  }
};

export const readJsonObject = async (filePath: string): Promise<JsonObject> =>
  jsonObjectSchema.parse(JSON.parse(await readFile(filePath, "utf8")));

export const writeJsonObject = async (filePath: string, value: JsonObject): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, undefined, 2)}\n`);
};

export const runCommand = (
  command: readonly [string, ...string[]],
  cwd: string,
  failureMessage: string,
): void => {
  writeLine(`$ ${command.join(" ")}`);
  const childProcess = spawnSync(command[0], command.slice(1), { cwd, stdio: "inherit" });
  if (childProcess.error !== undefined) throw childProcess.error;
  const exitCode = childProcess.status ?? 1;
  if (exitCode !== 0) fail(failureMessage);
};

export const rootNodeModulesCachePath = (...segments: readonly string[]): string =>
  nodePath.join(rootDirectory, "node_modules", ".cache", ...segments);
