import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCLI } from "../src/cli";
import type { RunCLIOptions } from "../src/cli";

export const cliPackageRoot: string = path.join(import.meta.dirname, "..");
export const binPath: string = path.join(cliPackageRoot, "bin", "x2zod.ts");
export const externalSchemaUri = "https://example.com/model.schema.json";
export const cliWorkspaceTemp: TempDirectoryOptions = {
  prefix: ".tmp-x2zod-cli-",
  root: cliPackageRoot,
};

const prettyJson = (value: unknown): string => JSON.stringify(value, undefined, 2);

export const draft7SchemaText: string = prettyJson({
  $schema: "http://json-schema.org/draft-07/schema#",
  properties: { name: { type: "string" } },
  required: ["name"],
  type: "object",
});

export const schemaText: string = prettyJson({
  properties: { name: { type: "string" } },
  required: ["name"],
  type: "object",
});

type TempDirectoryOptions = Readonly<{ prefix?: string | undefined; root?: string | undefined }>;
type CLITestOptions = Omit<RunCLIOptions, "stderr" | "stdout">;
export type CLITestResult = Readonly<{
  exitCode: number;
  stderr: readonly string[];
  stderrText: string;
  stdout: readonly string[];
  stdoutText: string;
}>;
type ConfiguredTargetOptions = Readonly<{
  options?: string | undefined;
  schemaText?: string | undefined;
}>;

export const withTempDirectory = async <T>(
  run: (directory: string) => Promise<T>,
  { prefix = "x2zod-cli-", root = os.tmpdir() }: TempDirectoryOptions = {},
): Promise<T> => {
  const directory = await mkdtemp(path.join(root, prefix));
  try {
    const result = await run(directory);
    return result;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

export const readText = async (filePath: string): Promise<string> => {
  const text = await readFile(filePath, "utf8");
  return text;
};

export const collectText =
  (texts: string[]): ((text: string) => void) =>
  (text) => {
    texts.push(text);
  };

export const runCLITest = async (
  argv: readonly string[],
  options: CLITestOptions = {},
): Promise<CLITestResult> => {
  const stderr: string[] = [];
  const stdout: string[] = [];
  const exitCode = await runCLI(argv, {
    ...options,
    stderr: collectText(stderr),
    stdout: collectText(stdout),
  });
  return { exitCode, stderr, stderrText: stderr.join(""), stdout, stdoutText: stdout.join("") };
};

export const assertCLISuccess = (result: CLITestResult): void => {
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stderr, []);
};

export const assertCLIConfigFailure = (result: CLITestResult): void => {
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderrText.includes("Required config"));
  assert.ok(!result.stderrText.includes("Bun v"));
  assert.ok(!result.stderrText.includes(" at "));
};

export const readGeneratedText = async (
  directory: string,
  relativePath = "generated/user.ts",
): Promise<string> => {
  const text = await readText(path.join(directory, relativePath));
  return text;
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, prettyJson(value));
};

export const writeConfiguredUserTarget = async (
  directory: string,
  { options, schemaText: targetSchemaText = schemaText }: ConfiguredTargetOptions = {},
): Promise<void> => {
  await mkdir(path.join(directory, "schemas"), { recursive: true });
  await writeFile(path.join(directory, "schemas", "user.schema.json"), targetSchemaText);
  await writeFile(
    path.join(directory, "x2zod.config.ts"),
    [
      'import { defineConfig } from "@x2zod/config";',
      'import { jsonSchemaInputPlugin } from "@x2zod/json-schema";',
      "",
      "export default defineConfig({",
      '  plugins: { "json-schema": jsonSchemaInputPlugin },',
      "  targets: {",
      "    user: {",
      '      kind: "json-schema",',
      '      input: { path: "schemas/user.schema.json" },',
      ...(options === undefined ? [] : [`      options: ${options},`]),
      '      output: { path: "generated/user.ts", typeName: "User" },',
      "    },",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
};

export const writeDynamicUserTarget = async (directory: string): Promise<void> => {
  await mkdir(path.join(directory, "schemas"), { recursive: true });
  await writeFile(path.join(directory, "schemas", "user.schema.json"), schemaText);
  await writeFile(
    path.join(directory, "x2zod.config.ts"),
    [
      'import { defineConfig } from "@x2zod/config";',
      'import { jsonSchemaInputPlugin } from "@x2zod/json-schema";',
      "",
      'const openApiPlugin = { ...jsonSchemaInputPlugin, kind: "openapi" as const };',
      "",
      "export default defineConfig({",
      "  plugins: { openapi: openApiPlugin },",
      "  targets: {",
      "    user: {",
      '      kind: "openapi",',
      '      input: { path: "schemas/user.schema.json" },',
      '      output: { path: "generated/user.ts", typeName: "User" },',
      "    },",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
};
