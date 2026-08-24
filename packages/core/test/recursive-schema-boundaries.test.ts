import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

import {
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
  outputText,
} from "../../../test/native-source-harness";

const corePackageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const fixtureDirectory = nodePath.join(import.meta.dirname, "fixtures/recursive-schema-boundaries");
const tempRootDirectory = nodePath.join(corePackageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-recursive-schema-boundaries-";
const typeScriptBinary = nodePath.resolve(corePackageRootDirectory, "../../node_modules/.bin/tsgo");

type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;

type RunTypeScriptRequest = Readonly<{
  args: readonly string[];
  cwd: string;
  entryPoint: string;
  withIsolatedDeclarations: boolean;
}>;
type TypeScriptResult = Readonly<{ status: number | null; output: string }>;

const fixture = (name: string): string =>
  readFileSync(nodePath.join(fixtureDirectory, `${name}.ts.txt`), "utf8");

const runTypeScript = ({
  args,
  cwd,
  entryPoint,
  withIsolatedDeclarations,
}: RunTypeScriptRequest): TypeScriptResult => {
  const result = spawnSync(
    typeScriptBinary,
    [
      "--ignoreConfig",
      ...(withIsolatedDeclarations ? ["--isolatedDeclarations"] : []),
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--skipLibCheck",
      "--strict",
      "--target",
      "es2022",
      ...args,
      entryPoint,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );

  return {
    output: `${outputText(result.stdout)}${outputText(result.stderr)}`,
    status: result.status,
  };
};

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

void describe("recursive Zod declaration boundaries", () => {
  void test("proves recursive inference fails while an explicit SCC boundary emits", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const nonrecursiveFile = nodePath.join(directory, "unsafe-nonrecursive.ts");
    const unsafeFile = nodePath.join(directory, "unsafe-unannotated.ts");
    const safeFile = nodePath.join(directory, "safe-explicit.ts");
    const declarationsDirectory = nodePath.join(directory, "declarations");

    try {
      await writeFile(nonrecursiveFile, fixture("unsafe-nonrecursive"));
      await writeFile(unsafeFile, fixture("unsafe-unannotated"));
      await writeFile(safeFile, fixture("safe-explicit"));

      const nonrecursiveResult = runTypeScript({
        args: [
          "--declaration",
          "--emitDeclarationOnly",
          "--outDir",
          nodePath.join(directory, "nonrecursive-declarations"),
        ],
        cwd: directory,
        entryPoint: nonrecursiveFile,
        withIsolatedDeclarations: false,
      });
      assert.equal(nonrecursiveResult.status, 0, nonrecursiveResult.output);

      const unsafeResult = runTypeScript({
        args: [
          "--declaration",
          "--emitDeclarationOnly",
          "--outDir",
          nodePath.join(directory, "unsafe-declarations"),
        ],
        cwd: directory,
        entryPoint: unsafeFile,
        withIsolatedDeclarations: false,
      });
      assert.notEqual(unsafeResult.status, 0);
      assert.match(unsafeResult.output, /TS7022/u);
      assert.match(unsafeResult.output, /TS7024/u);

      const safeResult = runTypeScript({
        args: ["--declaration", "--emitDeclarationOnly", "--outDir", declarationsDirectory],
        cwd: directory,
        entryPoint: safeFile,
        withIsolatedDeclarations: true,
      });
      assert.equal(safeResult.status, 0, safeResult.output);

      const consumerFile = nodePath.join(declarationsDirectory, "safe-consumer.ts");
      await writeFile(consumerFile, fixture("safe-consumer"));
      const consumerResult = runTypeScript({
        args: [
          "--declaration",
          "--emitDeclarationOnly",
          "--outDir",
          nodePath.join(directory, "consumer-declarations"),
        ],
        cwd: declarationsDirectory,
        entryPoint: consumerFile,
        withIsolatedDeclarations: true,
      });
      assert.equal(consumerResult.status, 0, consumerResult.output);

      const nodeSchema = await importGeneratedExport(safeFile, "nodeSchema", isRuntimeZodSchema);
      const leftSchema = await importGeneratedExport(safeFile, "leftSchema", isRuntimeZodSchema);
      assert.equal(
        nodeSchema.safeParse({ value: "root", children: [{ value: "leaf", children: [] }] })
          .success,
        true,
      );
      assert.equal(
        nodeSchema.safeParse({ value: "root", children: [{ value: 1, children: [] }] }).success,
        false,
      );
      assert.equal(
        leftSchema.safeParse({
          name: "left",
          right: { count: 1, left: { name: "nested", right: { count: 2 } } },
        }).success,
        true,
      );
      assert.equal(
        leftSchema.safeParse({ name: "left", right: { count: "invalid" } }).success,
        false,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
