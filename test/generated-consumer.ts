import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";

const typeScriptBinary = nodePath.resolve(import.meta.dirname, "../node_modules/.bin/tsgo");

// Generated modules promise inference, not isolatedDeclarations. Keep consumer strictness explicit:
// --strict alone does not catch unused bindings, indexed access, or exact optional properties.
export const checkGeneratedTypeScript = (
  request: Readonly<{
    cwd: string;
    files: readonly string[];
    outputDirectory?: string;
    moduleResolution?: "bundler" | "nodenext";
    timeoutMs: number;
  }>,
): void => {
  const moduleResolution = request.moduleResolution ?? "bundler";
  const result = spawnSync(
    typeScriptBinary,
    [
      "--ignoreConfig",
      "--module",
      moduleResolution === "nodenext" ? "nodenext" : "esnext",
      "--moduleResolution",
      moduleResolution,
      "--strict",
      "--noUnusedLocals",
      "--noUnusedParameters",
      "--noUncheckedIndexedAccess",
      "--exactOptionalPropertyTypes",
      "--noPropertyAccessFromIndexSignature",
      "--target",
      "es2022",
      ...(request.outputDirectory === undefined
        ? ["--noEmit"]
        : ["--declaration", "--emitDeclarationOnly", "--outDir", request.outputDirectory]),
      ...request.files,
    ],
    { cwd: request.cwd, encoding: "utf8", timeout: request.timeoutMs, killSignal: "SIGKILL" },
  );
  if (result.error !== undefined) throw result.error;
  assert.equal(result.signal, null, `TypeScript terminated by ${result.signal ?? "unknown"}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
};

// Check the same consumer against source and emitted declarations, with explicit generated roots
// So TypeScript also emits modules beneath node_modules-based fixture directories.
export const checkGeneratedConsumer = async (
  request: Readonly<{
    cwd: string;
    generatedFiles: readonly string[];
    consumerFile: string;
    consumerSource: string;
    outputDirectory: string;
    moduleResolution?: "bundler" | "nodenext";
    timeoutMs: number;
  }>,
): Promise<void> => {
  await writeFile(request.consumerFile, request.consumerSource);
  const compiler = {
    cwd: request.cwd,
    ...(request.moduleResolution === undefined
      ? {}
      : { moduleResolution: request.moduleResolution }),
    timeoutMs: request.timeoutMs,
  };
  checkGeneratedTypeScript({
    ...compiler,
    files: [...request.generatedFiles, request.consumerFile],
    outputDirectory: request.outputDirectory,
  });
  const declarationConsumer = nodePath.join(request.outputDirectory, "consumer-check.ts");
  await writeFile(declarationConsumer, request.consumerSource);
  checkGeneratedTypeScript({ ...compiler, files: [declarationConsumer] });
};
