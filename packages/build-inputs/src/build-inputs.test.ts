import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import * as tar from "tar";
import { z } from "zod/v4";

import { buildInputIdSchema, buildInputs, sha256HexSchema } from "./build-inputs";
import type { BuildInputId, Sha256Hex } from "./build-inputs";

const testUrl = "https://example.com/source.json";
const archiveTestUrl = "https://example.com/render-cli-source.tar.gz";
const originalFetch = globalThis.fetch;
const okJsonSchema = z.strictObject({ ok: z.literal(true) });
const nestedOkJsonSchema = z.strictObject({ nested: z.strictObject({ ok: z.literal(true) }) });
type FetchImplementation = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const buildInputId = (value: string): BuildInputId => buildInputIdSchema.parse(value);

const sha256Hex = (content: string): Sha256Hex =>
  sha256HexSchema.parse(createHash("sha256").update(content, "utf8").digest("hex"));

const writeJsonFile = async (filePath: string, value: object): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readRootText = async (rootDir: string, relativePath: string): Promise<string> => {
  const content = await readFile(path.join(rootDir, relativePath), "utf8");
  return content;
};

const assertRootText = async (
  rootDir: string,
  relativePath: string,
  expected: string,
): Promise<void> => {
  assert.equal(await readRootText(rootDir, relativePath), expected);
};

const assertRootTextContains = async (
  rootDir: string,
  relativePath: string,
  expected: string,
): Promise<void> => {
  assert.ok((await readRootText(rootDir, relativePath)).includes(expected));
};

const writeBuildInputsConfig = async (rootDir: string): Promise<void> => {
  await writeFile(
    path.join(rootDir, "build-inputs.json"),
    `${JSON.stringify(
      { inputs: [{ id: "source-json", path: "artifacts/source.json", url: testUrl }], version: 1 },
      null,
      2,
    )}\n`,
  );
};

const withTempRoot = async (
  prefix: string,
  run: (rootDir: string) => Promise<void>,
): Promise<void> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));

  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
};

const stubFetch = (fetchImplementation: FetchImplementation): void => {
  globalThis.fetch = fetchImplementation;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("buildInputs", () => {
  void test("writes normalized content and a deterministic lockfile", async () => {
    await withTempRoot("build-inputs-", async (rootDir) => {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      const result = await buildInputs({ mode: "update-lock", rootDir });
      const downloadedContent = await readRootText(rootDir, "artifacts/source.json");
      const expectedSha256 = sha256Hex(downloadedContent);
      const expectedSizeBytes = Buffer.byteLength(downloadedContent, "utf8");

      assert.equal(downloadedContent.endsWith("\n"), true);
      assert.deepEqual(okJsonSchema.parse(JSON.parse(downloadedContent)), { ok: true });
      assert.equal(
        await readRootText(rootDir, "build-inputs.lock.json"),
        `${JSON.stringify(
          {
            urls: { [testUrl]: { sha256: expectedSha256, sizeBytes: expectedSizeBytes } },
            version: 1,
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(result.lockfileUpdated, true);
      assert.deepEqual(result.inputs, [
        {
          id: buildInputId("source-json"),
          path: "artifacts/source.json",
          sha256: expectedSha256,
          sizeBytes: expectedSizeBytes,
          url: testUrl,
        },
      ]);
    });
  });

  void test("normalizes JSON content before hashing and writing", async () => {
    await withTempRoot("build-inputs-normalize-", async (rootDir) => {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"nested":{"ok":true}}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      const result = await buildInputs({ mode: "update-lock", rootDir });
      const downloadedContent = await readRootText(rootDir, "artifacts/source.json");
      const [input] = result.inputs;

      if (!input) throw new Error("Expected a build input result");

      assert.deepEqual(nestedOkJsonSchema.parse(JSON.parse(downloadedContent)), {
        nested: { ok: true },
      });
      assert.equal(downloadedContent, '{ "nested": { "ok": true } }\n');
      assert.equal(input.sha256, sha256Hex(downloadedContent));
    });
  });

  void test("rejects remote content that does not match the lock", async () => {
    await withTempRoot("build-inputs-lock-", async (rootDir) => {
      const lockedContent = `${JSON.stringify({ ok: true }, null, 2)}\n`;

      await writeBuildInputsConfig(rootDir);
      await writeFile(
        path.join(rootDir, "build-inputs.lock.json"),
        `${JSON.stringify(
          {
            urls: {
              [testUrl]: {
                sha256: sha256Hex(lockedContent),
                sizeBytes: Buffer.byteLength(lockedContent, "utf8"),
              },
            },
            version: 1,
          },
          null,
          2,
        )}\n`,
      );
      stubFetch(
        async () =>
          new Response('{"ok":false}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      await assert.rejects(
        buildInputs({ mode: "materialize", rootDir }),
        (error: unknown): boolean => String(error).includes("changed"),
      );
    });
  });

  void test("defaults the public API mode to materialize", async () => {
    await withTempRoot("build-inputs-default-", async (rootDir) => {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );
      await buildInputs({ mode: "update-lock", rootDir });
      const lockfileContent = await readRootText(rootDir, "build-inputs.lock.json");

      const result = await buildInputs({ rootDir });

      assert.equal(result.mode, "materialize");
      assert.equal(result.lockfileUpdated, false);
      assert.equal(await readRootText(rootDir, "build-inputs.lock.json"), lockfileContent);
    });
  });

  void test("rejects duplicate URLs with different inferred formats", async () => {
    await withTempRoot("build-inputs-format-", async (rootDir) => {
      await writeFile(
        path.join(rootDir, "build-inputs.json"),
        `${JSON.stringify(
          {
            inputs: [
              { id: "source-json", path: "artifacts/source.json", url: testUrl },
              { id: "source-text", path: "artifacts/source.txt", url: testUrl },
            ],
            version: 1,
          },
          null,
          2,
        )}\n`,
      );

      await assert.rejects(
        buildInputs({ mode: "update-lock", rootDir }),
        (error: unknown): boolean =>
          String(error).includes("declared with both 'json' and 'text' formats"),
      );
    });
  });

  void test("rejects overlapping output paths", async () => {
    await withTempRoot("build-inputs-overlap-", async (rootDir) => {
      await writeJsonFile(path.join(rootDir, "build-inputs.json"), {
        inputs: [
          { id: "source-json", path: "artifacts/source.json", url: testUrl },
          {
            archiveFormat: "tar.gz",
            id: "source-archive",
            type: "archive",
            unpack: { directory: "artifacts" },
            url: archiveTestUrl,
          },
        ],
        version: 1,
      });

      await assert.rejects(
        buildInputs({ mode: "update-lock", rootDir }),
        (error: unknown): boolean => String(error).includes("overlaps"),
      );
    });
  });

  void test("updates all file outputs sharing a selected URL", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-shared-url-"));
    let responseVersion = 1;

    try {
      await writeJsonFile(path.join(rootDir, "build-inputs.json"), {
        inputs: [
          { id: "source-a", path: "artifacts/source-a.json", url: testUrl },
          { id: "source-b", path: "artifacts/source-b.json", url: testUrl },
        ],
        version: 1,
      });
      stubFetch(
        async () =>
          new Response(JSON.stringify({ version: responseVersion }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      await buildInputs({ mode: "update-lock", rootDir });
      responseVersion = 2;

      const result = await buildInputs({
        ids: [buildInputId("source-a")],
        mode: "update-lock",
        rootDir,
      });

      assert.deepEqual(
        result.inputs.map((input) => String(input.id)),
        ["source-a", "source-b"],
      );
      await assertRootTextContains(rootDir, "artifacts/source-a.json", '"version": 2');
      await assertRootTextContains(rootDir, "artifacts/source-b.json", '"version": 2');
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  void test("validates the rendered lock before materializing selected outputs", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-preflight-"));

    try {
      await writeJsonFile(path.join(rootDir, "build-inputs.json"), {
        inputs: [
          { id: "source-json", path: "artifacts/source.json", url: testUrl },
          { id: "other-json", path: "artifacts/other.json", url: "https://example.com/other.json" },
        ],
        version: 1,
      });
      stubFetch(
        async () =>
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      await assert.rejects(
        buildInputs({ ids: [buildInputId("source-json")], mode: "update-lock", rootDir }),
        (error: unknown): boolean => String(error).includes("No lock entry exists"),
      );
      await assert.rejects(readRootText(rootDir, "artifacts/source.json"));
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  void test(
    "materializes a tar.gz archive with strip/include/exclude policy " +
      "and locks the output tree",
    async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-archive-"));
      const archiveFixtureRoot = path.join(rootDir, "fixture");
      const archiveSourceRoot = path.join(archiveFixtureRoot, "render-oss-cli-v2.16.0");
      const archivePath = path.join(rootDir, "render-cli-source.tar.gz");
      const longArchiveFileName = `${"long-name-".repeat(16)}root.go`;

      try {
        await mkdir(path.join(archiveSourceRoot, "cmd"), { recursive: true });
        await mkdir(path.join(archiveSourceRoot, "pkg", "auth"), { recursive: true });
        await writeFile(path.join(archiveSourceRoot, "go.mod"), "module cli\n");
        await writeFile(path.join(archiveSourceRoot, "cmd", "root.go"), "package cmd\n");
        await writeFile(path.join(archiveSourceRoot, "cmd", longArchiveFileName), "package cmd\n");
        await writeFile(path.join(archiveSourceRoot, "pkg", "auth", "auth.go"), "package auth\n");
        await writeFile(
          path.join(archiveSourceRoot, "pkg", "auth", "ignored_test.go"),
          "package auth\n",
        );
        await writeFile(path.join(archiveSourceRoot, "README.md"), "# Render CLI\n");
        await symlink("cmd/root.go", path.join(archiveSourceRoot, "ignored-link"));

        await tar.create(
          { cwd: archiveFixtureRoot, file: archivePath, gzip: true, noMtime: true, portable: true },
          ["render-oss-cli-v2.16.0"],
        );
        await writeFile(
          path.join(rootDir, "build-inputs.json"),
          `${JSON.stringify(
            {
              inputs: [
                {
                  archiveFormat: "tar.gz",
                  id: "render-cli-source",
                  type: "archive",
                  unpack: {
                    directory: "artifacts/render-cli-source",
                    exclude: ["**/*_test.go"],
                    include: ["cmd/**", "go.mod", "pkg/**"],
                    stripComponents: 1,
                  },
                  url: archiveTestUrl,
                },
              ],
              version: 1,
            },
            null,
            2,
          )}\n`,
        );
        stubFetch(async () => new Response(await readFile(archivePath), { status: 200 }));

        const updateResult = await buildInputs({ mode: "update-lock", rootDir });
        const [archiveResult] = updateResult.inputs;

        if (!archiveResult) throw new Error("Expected an archive input result");
        if (archiveResult.type !== "archive") throw new Error("Expected an archive input result");

        await assertRootText(rootDir, "artifacts/render-cli-source/cmd/root.go", "package cmd\n");
        await assertRootText(
          rootDir,
          path.join("artifacts/render-cli-source/cmd", longArchiveFileName),
          "package cmd\n",
        );
        await assertRootText(
          rootDir,
          "artifacts/render-cli-source/pkg/auth/auth.go",
          "package auth\n",
        );
        await assert.rejects(
          readRootText(rootDir, "artifacts/render-cli-source/pkg/auth/ignored_test.go"),
        );
        await assert.rejects(readRootText(rootDir, "artifacts/render-cli-source/README.md"));

        assert.partialDeepStrictEqual(archiveResult, {
          id: "render-cli-source",
          path: "artifacts/render-cli-source",
          sourceSizeBytes: (await readFile(archivePath)).byteLength,
          type: "archive",
          url: archiveTestUrl,
        });
        assert.match(String(archiveResult.materializationSha256), /^[0-9a-f]{64}$/u);
        assert.match(String(archiveResult.sourceSha256), /^[0-9a-f]{64}$/u);
        assert.match(String(archiveResult.sha256), /^[0-9a-f]{64}$/u);

        const checkResult = await buildInputs({ mode: "check", rootDir });

        assert.deepEqual(checkResult.inputs, updateResult.inputs);
      } finally {
        await rm(rootDir, { force: true, recursive: true });
      }
    },
  );

  void test("updates all archive outputs sharing a selected URL", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-archives-"));
    const archiveFixtureRoot = path.join(rootDir, "fixture");
    const archiveSourceRoot = path.join(archiveFixtureRoot, "render-oss-cli-v2.16.0");
    const archivePath = path.join(rootDir, "render-cli-source.tar.gz");

    const writeArchive = async (version: string): Promise<void> => {
      await rm(archiveFixtureRoot, { force: true, recursive: true });
      await mkdir(path.join(archiveSourceRoot, "cmd"), { recursive: true });
      await writeFile(
        path.join(archiveSourceRoot, "cmd", "root.go"),
        `package cmd\nconst version = "${version}"\n`,
      );
      await tar.create(
        { cwd: archiveFixtureRoot, file: archivePath, gzip: true, noMtime: true, portable: true },
        ["render-oss-cli-v2.16.0"],
      );
    };

    try {
      await writeJsonFile(path.join(rootDir, "build-inputs.json"), {
        inputs: [
          {
            archiveFormat: "tar.gz",
            id: "render-cli-source",
            type: "archive",
            unpack: {
              directory: "artifacts/render-cli-source",
              include: ["cmd/**"],
              stripComponents: 1,
            },
            url: archiveTestUrl,
          },
          {
            archiveFormat: "tar.gz",
            id: "render-cli-copy",
            type: "archive",
            unpack: {
              directory: "artifacts/render-cli-copy",
              include: ["cmd/**"],
              stripComponents: 1,
            },
            url: archiveTestUrl,
          },
        ],
        version: 1,
      });
      stubFetch(async () => new Response(await readFile(archivePath), { status: 200 }));

      await writeArchive("one");
      await buildInputs({ mode: "update-lock", rootDir });
      await writeArchive("two");

      const result = await buildInputs({
        ids: [buildInputId("render-cli-source")],
        mode: "update-lock",
        rootDir,
      });

      assert.deepEqual(
        result.inputs.map((input) => String(input.id)),
        ["render-cli-source", "render-cli-copy"],
      );
      await assertRootTextContains(
        rootDir,
        "artifacts/render-cli-source/cmd/root.go",
        'version = "two"',
      );
      await assertRootTextContains(
        rootDir,
        "artifacts/render-cli-copy/cmd/root.go",
        'version = "two"',
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
