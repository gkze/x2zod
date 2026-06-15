import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import { isRecord } from "./structural";

export { isRecord } from "./structural";

const textDecoder = new TextDecoder();
export const nativePreviewShutdownStderr = "context canceled\n";
const bunExecutable = process.execPath;

export const nativePreviewExternals = [
  "@typescript/native-preview/unstable/ast",
  "@typescript/native-preview/unstable/ast/factory",
  "@typescript/native-preview/unstable/async",
  "@typescript/native-preview/unstable/sync",
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
  const result = spawnSync(
    bunExecutable,
    [
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
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(outputText(result.stderr), "");
  assert.equal(result.status, 0);
};

export const createTemporaryDirectory = ({
  prefix,
  rootDirectory,
}: CreateTemporaryDirectoryRequest): string => {
  mkdirSync(rootDirectory, { recursive: true });
  return mkdtempSync(nodePath.join(rootDirectory, prefix));
};

export const runNode = ({ allowedStderr, args, cwd }: RunNodeRequest): string => {
  const result = spawnSync("node", ["--no-warnings", ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = outputText(result.stderr);
  if (stderr !== "" && allowedStderr?.(stderr) !== true) assert.equal(stderr, "");
  assert.equal(result.status, 0);
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
