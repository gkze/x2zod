import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  nativePreviewExternals,
  runNode,
} from "../../../../test/native-source-harness";
import {
  officialSuiteRuntimeBatchResultSchema,
  officialSuiteRuntimeBatchSchema,
  officialSuiteRuntimeProgressSchema,
} from "./runtime-contract";
import { runOfficialSuiteRuntimeProcess } from "./runtime-process";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "../..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const runtimeHelperEntryPoint = nodePath.join(import.meta.dirname, "runtime-helper.ts");
const runtimeTimeoutMs = 1000;

void test("runtime failure results have one flat identity and non-empty codes", () => {
  const failure = {
    codes: ["validity_mismatch"],
    id: "draft-7:type.json:0:0",
    ok: false,
    phase: "runtime",
  } as const;
  assert.deepEqual(officialSuiteRuntimeBatchResultSchema.parse({ results: [failure] }), {
    results: [failure],
  });
  assert.throws(() =>
    officialSuiteRuntimeBatchResultSchema.parse({
      results: [{ gap: failure, id: failure.id, ok: false }],
    }),
  );
  assert.throws(() =>
    officialSuiteRuntimeBatchResultSchema.parse({ results: [{ ...failure, codes: [] }] }),
  );
});

void test("generated runtime evaluation can be terminated at its deadline", async () => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-official-suite-runtime-helper-",
    rootDirectory: tempRootDirectory,
  });
  const batchFile = nodePath.join(directory, "runtime-batch.json");
  const bundleFile = nodePath.join(directory, "official-suite-runtime-helper.mjs");
  const generatedFile = nodePath.join(directory, "nonterminating-schema.mjs");
  const progressFile = nodePath.join(directory, "runtime-progress.json");
  const startedFile = nodePath.join(directory, "runtime-started.txt");

  try {
    const batch = officialSuiteRuntimeBatchSchema.parse({
      groups: [
        {
          cases: [{ data: "value", expectedValid: true, id: "draft-7:pattern.json:0:0" }],
          generatedFile,
          id: "draft-7:pattern.json:0",
        },
      ],
    });
    await Promise.all([
      writeFile(batchFile, JSON.stringify(batch)),
      writeFile(
        generatedFile,
        `import { writeFileSync } from "node:fs";
export const officialSuiteCaseSchema = {
  safeParse: () => {
    writeFileSync(${JSON.stringify(startedFile)}, "started");
    while (true) {}
  },
};
`,
      ),
    ]);
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: runtimeHelperEntryPoint,
      externals: nativePreviewExternals,
      outfile: bundleFile,
    });

    let runtimeError: unknown = null;
    try {
      runOfficialSuiteRuntimeProcess({
        batchFile,
        bundleFile,
        cwd: packageRootDirectory,
        describeId: (id) =>
          id === "draft-7:pattern.json:0:0" ? 'group "pattern"; case "never returns"' : undefined,
        failureContext: 'draft-7:pattern.json:0 (group "pattern")',
        progressFile,
        timeoutMs: runtimeTimeoutMs,
      });
    } catch (error) {
      runtimeError = error;
    }
    assert.ok(runtimeError instanceof Error);
    assert.equal(
      runtimeError.message,
      'Official-suite generated runtime batch failed for:\ndraft-7:pattern.json:0 (group "pattern")\nActive runtime validation: draft-7:pattern.json:0:0 (group "pattern"; case "never returns")',
    );
    assert.ok(runtimeError.cause instanceof Error);
    assert.equal(
      runtimeError.cause.message,
      `Node subprocess exceeded its ${runtimeTimeoutMs.toString()}ms timeout.`,
    );
    assert.equal(readFileSync(startedFile, "utf8"), "started");
    assert.deepEqual(
      officialSuiteRuntimeProgressSchema.parse(
        JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
      ),
      { id: "draft-7:pattern.json:0:0", phase: "runtime" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("generated runtime evaluation reports one ordered result per case", async () => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-official-suite-runtime-helper-",
    rootDirectory: tempRootDirectory,
  });
  const batchFile = nodePath.join(directory, "runtime-batch.json");
  const bundleFile = nodePath.join(directory, "official-suite-runtime-helper.mjs");
  const generatedFile = nodePath.join(directory, "schema.mjs");
  const progressFile = nodePath.join(directory, "runtime-progress.json");
  const specialPropertyData: unknown = JSON.parse('{"__proto__":"value"}');

  try {
    const batch = officialSuiteRuntimeBatchSchema.parse({
      groups: [
        {
          cases: [
            { data: "valid", expectedValid: true, id: "draft-7:type.json:0:0" },
            { data: 42, expectedValid: false, id: "draft-7:type.json:0:1" },
            { data: 42, expectedValid: true, id: "draft-7:type.json:0:2" },
            { data: "transformed", expectedValid: true, id: "draft-7:type.json:0:3" },
            { data: specialPropertyData, expectedValid: true, id: "draft-7:type.json:0:4" },
          ],
          generatedFile,
          id: "draft-7:type.json:0",
        },
      ],
    });
    await Promise.all([
      writeFile(batchFile, JSON.stringify(batch)),
      writeFile(
        generatedFile,
        `export const officialSuiteCaseSchema = {
  safeParse: (value) =>
    value === "valid"
      ? { data: value, success: true }
      : value === "transformed"
        ? { data: "changed", success: true }
        : value !== null && typeof value === "object" && Object.hasOwn(value, "__proto__")
          ? { data: value, success: true }
        : { success: false },
};
`,
      ),
    ]);
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: runtimeHelperEntryPoint,
      externals: nativePreviewExternals,
      outfile: bundleFile,
    });

    const result = officialSuiteRuntimeBatchResultSchema.parse(
      JSON.parse(
        runNode({
          args: [bundleFile, batchFile, progressFile],
          cwd: packageRootDirectory,
          timeoutMs: 5000,
        }),
      ) as unknown,
    );

    assert.deepEqual(result.results, [
      { id: "draft-7:type.json:0:0", ok: true },
      { id: "draft-7:type.json:0:1", ok: true },
      { codes: ["validity_mismatch"], id: "draft-7:type.json:0:2", ok: false, phase: "runtime" },
      {
        codes: ["parse_identity_mismatch"],
        id: "draft-7:type.json:0:3",
        ok: false,
        phase: "runtime",
      },
      { id: "draft-7:type.json:0:4", ok: true },
    ]);
    assert.deepEqual(
      officialSuiteRuntimeProgressSchema.parse(
        JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
      ),
      { id: "draft-7:type.json:0:4", phase: "runtime" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
