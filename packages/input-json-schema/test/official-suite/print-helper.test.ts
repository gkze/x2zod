import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../../test/native-source-harness";
import { isJsonObject } from "../../src/document";
import {
  officialSuitePrintBatchResultSchema,
  officialSuitePrintBatchSchema,
  officialSuitePrintProgressSchema,
} from "./print-contract";
import { runOfficialSuitePrintProcess } from "./print-process";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "../..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const printerHelperEntryPoint = nodePath.join(import.meta.dirname, "print-helper.ts");
const officialSuiteNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;
const printTimeoutMs = 1000;

void test("compiler failure results require at least one valid diagnostic", () => {
  assert.throws(() =>
    officialSuitePrintBatchResultSchema.parse({
      results: [{ diagnostics: [], id: "draft-7:unsupported.json:0", ok: false }],
    }),
  );
  assert.throws(() =>
    officialSuitePrintBatchResultSchema.parse({
      results: [
        {
          diagnostics: [
            {
              code: "not_a_diagnostic",
              message: "invalid diagnostic code",
              pointer: null,
              severity: "error",
            },
          ],
          id: "draft-7:unsupported.json:0",
          ok: false,
        },
      ],
    }),
  );
});

void test("official suite batches preserve special schema object keys", () => {
  const schema: unknown = JSON.parse('{"properties":{"__proto__":{"type":"number"}}}');
  const parsed = officialSuitePrintBatchSchema.parse({
    requests: [{ dialect: "draft-7", id: "properties.json:5", schema }],
  });
  const serialized = JSON.stringify(parsed);
  const transported: unknown = JSON.parse(serialized);
  const roundTripped = officialSuitePrintBatchSchema.parse(transported);
  const [request] = roundTripped.requests;
  assert.ok(request !== undefined);
  assert.ok(isJsonObject(request.schema));
  const { properties } = request.schema;
  assert.ok(isJsonObject(properties));
  assert.equal(Object.hasOwn(properties, "__proto__"), true);
});

void test("official suite compiler records the active compile request", async () => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-official-suite-print-helper-",
    rootDirectory: tempRootDirectory,
  });
  const batchFile = nodePath.join(directory, "batch.json");
  const bundleFile = nodePath.join(directory, "official-suite-print-helper.mjs");
  const externalSchemasFile = nodePath.join(directory, "external-schemas.json");
  const progressFile = nodePath.join(directory, "print-progress.json");

  try {
    await Promise.all([
      writeFile(
        batchFile,
        JSON.stringify({
          requests: [{ dialect: "draft-7", id: "unsupported.json", schema: { uniqueItems: true } }],
        }),
      ),
      writeFile(externalSchemasFile, "{}"),
    ]);
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: printerHelperEntryPoint,
      externals: officialSuiteNativePreviewExternals,
      outfile: bundleFile,
    });

    const output = officialSuitePrintBatchResultSchema.parse(
      JSON.parse(
        runNode({
          allowedStderr: isNativePreviewShutdownStderr,
          args: [bundleFile, batchFile, externalSchemasFile, progressFile],
          cwd: packageRootDirectory,
        }),
      ),
    );

    assert.equal(output.results[0]?.ok, false);
    assert.deepEqual(
      officialSuitePrintProgressSchema.parse(
        JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
      ),
      { id: "unsupported.json", phase: "compile" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("official suite compiler returns an ordered result for every batch request", async () => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-official-suite-print-helper-",
    rootDirectory: tempRootDirectory,
  });
  const batchFile = nodePath.join(directory, "batch.json");
  const bundleFile = nodePath.join(directory, "official-suite-print-helper.mjs");
  const externalSchemasFile = nodePath.join(directory, "external-schemas.json");
  const progressFile = nodePath.join(directory, "print-progress.json");

  try {
    await Promise.all([
      writeFile(
        batchFile,
        JSON.stringify({
          requests: [
            { dialect: "draft-7", id: "supported.json", schema: { type: "string" } },
            { dialect: "draft-7", id: "unsupported.json", schema: { uniqueItems: true } },
          ],
        }),
      ),
      writeFile(externalSchemasFile, "{}"),
    ]);
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint: printerHelperEntryPoint,
      externals: officialSuiteNativePreviewExternals,
      outfile: bundleFile,
    });

    const output = officialSuitePrintBatchResultSchema.parse(
      JSON.parse(
        runNode({
          allowedStderr: isNativePreviewShutdownStderr,
          args: [bundleFile, batchFile, externalSchemasFile, progressFile],
          cwd: packageRootDirectory,
        }),
      ),
    );

    assert.deepEqual(
      output.results.map(({ id }) => id),
      ["supported.json", "unsupported.json"],
    );
    const [supported, unsupported] = output.results;
    assert.ok(supported !== undefined);
    assert.equal(supported.ok, true);
    assert.match(supported.source, /officialSuiteCaseSchema/u);
    assert.match(supported.source, /z\.string/u);
    assert.ok(unsupported !== undefined);
    assert.equal(unsupported.ok, false);
    assert.deepEqual(
      unsupported.diagnostics.map(({ code }) => code),
      ["unsupported_keyword"],
    );
    assert.deepEqual(
      officialSuitePrintProgressSchema.parse(
        JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
      ),
      { id: "supported.json", phase: "source_emit" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("compiler timeout reports the exact active compile request", async () => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-official-suite-print-process-",
    rootDirectory: tempRootDirectory,
  });
  const batchFile = nodePath.join(directory, "batch.json");
  const bundleFile = nodePath.join(directory, "nonterminating-print-helper.mjs");
  const externalSchemasFile = nodePath.join(directory, "external-schemas.json");
  const progressFile = nodePath.join(directory, "print-progress.json");
  const startedFile = nodePath.join(directory, "print-started.txt");
  const activeId = "draft-7:pattern.json:1";

  try {
    await Promise.all([
      writeFile(batchFile, JSON.stringify({ requests: [] })),
      writeFile(externalSchemasFile, "{}"),
      writeFile(
        bundleFile,
        `import { renameSync, writeFileSync } from "node:fs";
const progressFile = process.argv[4];
writeFileSync(progressFile + ".tmp", ${JSON.stringify(
          JSON.stringify({ id: activeId, phase: "compile" }),
        )});
renameSync(progressFile + ".tmp", progressFile);
writeFileSync(${JSON.stringify(startedFile)}, "started");
while (true) {}
`,
      ),
    ]);

    let printError: unknown = null;
    try {
      runOfficialSuitePrintProcess({
        batchFile,
        bundleFile,
        cwd: packageRootDirectory,
        describeId: (id) => (id === activeId ? 'group "pattern"' : undefined),
        externalSchemasFile,
        failureContext: `${activeId} (group "pattern")`,
        progressFile,
        timeoutMs: printTimeoutMs,
      });
    } catch (error) {
      printError = error;
    }

    assert.ok(printError instanceof Error);
    assert.equal(
      printError.message,
      `Official-suite compiler batch failed for:\n${activeId} (group "pattern")\n` +
        `Active schema compilation: ${activeId} (group "pattern")`,
    );
    assert.ok(printError.cause instanceof Error);
    assert.equal(
      printError.cause.message,
      `Node subprocess exceeded its ${printTimeoutMs.toString()}ms timeout.`,
    );
    assert.equal(readFileSync(startedFile, "utf8"), "started");
    assert.deepEqual(
      officialSuitePrintProgressSchema.parse(
        JSON.parse(readFileSync(progressFile, "utf8")) as unknown,
      ),
      { id: activeId, phase: "compile" },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("node subprocesses fail clearly when their timeout elapses", () => {
  assert.throws(() => runNode({ args: ["--eval", "setTimeout(() => {}, 1_000)"], timeoutMs: 25 }), {
    message: "Node subprocess exceeded its 25ms timeout.",
  });
});
