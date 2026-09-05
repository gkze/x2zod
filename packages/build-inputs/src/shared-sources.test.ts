import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildInputs } from "./build-inputs";
import { sha256Hex } from "./hash";
import { renderBuildInputsLock } from "./lockfile";
import { buildInputsLockSchema, resolvedBuildInputFileSchema } from "./schemas";

void test("fetches a shared file URL once so every output matches its lock", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-shared-response-"));
  const originalFetch = globalThis.fetch;
  try {
    const url = "https://example.com/source.txt";
    await writeFile(
      path.join(rootDir, "build-inputs.json"),
      JSON.stringify({
        inputs: [
          { format: "text", id: "first", path: "first.txt", url },
          { format: "text", id: "second", path: "second.txt", url },
        ],
        version: 1,
      }),
    );
    let fetchCalls = 0;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCalls += 1;
      return new Response(`value-${fetchCalls.toString()}`);
    };

    const updated = await buildInputs({ mode: "update-lock", rootDir });
    const checked = await buildInputs({ mode: "check", rootDir });

    assert.equal(fetchCalls, 1);
    assert.equal(await readFile(path.join(rootDir, "first.txt"), "utf8"), "value-1\n");
    assert.equal(await readFile(path.join(rootDir, "second.txt"), "utf8"), "value-1\n");
    assert.deepEqual(checked.inputs, updated.inputs);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(rootDir, { force: true, recursive: true });
  }
});

void test("rejects different normalized outputs sharing one lock entry", () => {
  const inputs = ["first", "second"].map((id) =>
    resolvedBuildInputFileSchema.parse({
      absolutePath: path.join(tmpdir(), `${id}.txt`),
      format: "text",
      id,
      path: `${id}.txt`,
      url: "https://example.com/shared.txt",
    }),
  );
  const downloads = inputs.map((input) => ({
    content: input.id,
    input,
    sha256: sha256Hex(input.id),
    sizeBytes: Buffer.byteLength(input.id),
  }));

  assert.throws(
    () =>
      renderBuildInputsLock(
        inputs,
        buildInputsLockSchema.parse({ urls: {}, version: 1 }),
        downloads,
        [],
      ),
    /produced different normalized content/u,
  );
});
