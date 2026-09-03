import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import nodePath from "node:path";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";

const corePackageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const coreEntrypoint = "src/index.ts";
const typeScriptBinary = nodePath.resolve(corePackageRootDirectory, "../../node_modules/.bin/tsgo");

export type GeneratedSourceHarness = Readonly<{
  directory: string;
  dispose: () => void;
  generatedFile: string;
  print: (args?: readonly string[]) => string;
}>;

export const createGeneratedSourceHarness = (input: {
  readonly prefix: string;
  readonly printerEntryPoint: string;
}): GeneratedSourceHarness => {
  const directory = createTemporaryDirectory({
    prefix: input.prefix,
    rootDirectory: nodePath.join(corePackageRootDirectory, "node_modules/.cache"),
  });
  const coreBundleFile = nodePath.join(directory, "core.mjs");
  const printerBundleFile = nodePath.join(directory, "printer.mjs");
  const dispose = (): void => {
    rmSync(directory, { force: true, recursive: true });
  };

  try {
    buildNodeBundle({
      cwd: corePackageRootDirectory,
      entryPoint: coreEntrypoint,
      externals: nativePreviewExternals,
      outfile: coreBundleFile,
    });
    buildNodeBundle({
      cwd: corePackageRootDirectory,
      entryPoint: input.printerEntryPoint,
      externals: nativePreviewExternals,
      outfile: printerBundleFile,
    });
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    directory,
    dispose,
    generatedFile: nodePath.join(directory, "generated-runtime.ts"),
    print: (args = []) =>
      runNode({
        allowedStderr: isNativePreviewShutdownStderr,
        args: [printerBundleFile, coreBundleFile, ...args],
        cwd: corePackageRootDirectory,
      }),
  };
};

export const emitGeneratedDeclarations = (sourceFile: string, outputDirectory: string): void => {
  mkdirSync(outputDirectory, { recursive: true });
  const result = spawnSync(
    typeScriptBinary,
    [
      "--declaration",
      "--emitDeclarationOnly",
      "--ignoreConfig",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--outDir",
      outputDirectory,
      "--skipLibCheck",
      "--strict",
      "--target",
      "es2022",
      sourceFile,
    ],
    { cwd: corePackageRootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
};
