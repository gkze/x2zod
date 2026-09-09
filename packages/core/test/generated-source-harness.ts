import { rmSync } from "node:fs";
import nodePath from "node:path";

import { checkGeneratedTypeScript } from "../../../test/generated-consumer";
import {
  buildNodeBundle,
  createTemporaryDirectory,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";

const corePackageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const defaultDeclarationTimeoutMs = 15_000;
const coreEntrypoint = "src/index.ts";

export type GeneratedSourceHarness = Readonly<{
  directory: string;
  dispose: () => void;
  generatedFile: string;
  print: (args?: readonly string[]) => string;
}>;

export const createGeneratedSourceHarness = (input: {
  readonly prefix: string;
  readonly printerEntryPoint: string;
  readonly nativeProcessTimeoutMs?: number;
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
        ...(input.nativeProcessTimeoutMs === undefined
          ? {}
          : { timeoutMs: input.nativeProcessTimeoutMs }),
      }),
  };
};

export const emitGeneratedDeclarations = (
  sourceFile: string,
  outputDirectory: string,
  timeoutMs?: number,
): void => {
  checkGeneratedTypeScript({
    cwd: corePackageRootDirectory,
    files: [sourceFile],
    outputDirectory,
    moduleResolution: "nodenext",
    timeoutMs: timeoutMs ?? defaultDeclarationTimeoutMs,
  });
};
