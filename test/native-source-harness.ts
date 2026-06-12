import { expect } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isRecord } from "./structural";
export { isRecord } from "./structural";

const textDecoder = new TextDecoder();
export const nativePreviewShutdownStderr = "context canceled\n";

export const nativePreviewExternals = [
  "@typescript/native-preview/ast",
  "@typescript/native-preview/ast/factory",
  "@typescript/native-preview/sync",
  "zod/v4",
] as const;

type BuildNodeBundleRequest = Readonly<{
  cwd: string;
  entryPoint: string;
  externals: readonly string[];
  outfile: string;
}>;

type CreateTemporaryDirectoryRequest = Readonly<{ prefix: string; rootDirectory: string }>;

type RunNodeRequest = Readonly<{
  allowedStderr?: ((stderr: string) => boolean) | undefined;
  args: readonly string[];
  cwd?: string;
}>;

export const outputText = (output: Uint8Array): string => textDecoder.decode(output);

export const isNativePreviewShutdownStderr = (stderr: string): boolean =>
  stderr === nativePreviewShutdownStderr;

export const buildNodeBundle = ({
  cwd,
  entryPoint,
  externals,
  outfile,
}: BuildNodeBundleRequest): void => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      entryPoint,
      "--outfile",
      outfile,
      "--target",
      "node",
      "--format",
      "esm",
      ...externals.flatMap((external) => ["--external", external]),
    ],
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(outputText(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
};

export const createTemporaryDirectory = ({
  prefix,
  rootDirectory,
}: CreateTemporaryDirectoryRequest): string => {
  mkdirSync(rootDirectory, { recursive: true });
  return mkdtempSync(join(rootDirectory, prefix));
};

export const runNode = ({ allowedStderr, args, cwd }: RunNodeRequest): string => {
  const result = Bun.spawnSync({
    cmd: ["node", "--no-warnings", ...args],
    ...(cwd === undefined ? {} : { cwd }),
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr = outputText(result.stderr);
  if (stderr !== "" && allowedStderr?.(stderr) !== true) expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return outputText(result.stdout);
};

export const importGeneratedExport = async <TValue>(
  generatedFile: string,
  exportName: string,
  isExport: (value: unknown) => value is TValue,
): Promise<TValue> => {
  const imported: unknown = await import(pathToFileURL(generatedFile).href);
  if (!isRecord(imported)) throw new Error("Generated module did not import as an object.");

  const exportedValue = imported[exportName];
  if (!isExport(exportedValue)) throw new Error(`Generated module is missing ${exportName}.`);

  return exportedValue;
};
