import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

const stubFetch = (fetchImplementation: FetchImplementation): void => {
  globalThis.fetch = Object.assign(fetchImplementation, { preconnect: originalFetch.preconnect });
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildInputs", () => {
  test("writes normalized content and a deterministic lockfile", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-"));

    try {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      const result = await buildInputs({ mode: "update-lock", rootDir });
      const downloadedContent = await readFile(
        path.join(rootDir, "artifacts", "source.json"),
        "utf8",
      );
      const expectedSha256 = sha256Hex(downloadedContent);
      const expectedSizeBytes = Buffer.byteLength(downloadedContent, "utf8");

      expect(downloadedContent.endsWith("\n")).toBe(true);
      expect(okJsonSchema.parse(JSON.parse(downloadedContent))).toEqual({ ok: true });
      await expect(readFile(path.join(rootDir, "build-inputs.lock.json"), "utf8")).resolves.toBe(
        `${JSON.stringify(
          {
            urls: { [testUrl]: { sha256: expectedSha256, sizeBytes: expectedSizeBytes } },
            version: 1,
          },
          null,
          2,
        )}\n`,
      );
      expect(result.lockfileUpdated).toBe(true);
      expect(result.inputs).toEqual([
        {
          id: buildInputId("source-json"),
          path: "artifacts/source.json",
          sha256: expectedSha256,
          sizeBytes: expectedSizeBytes,
          url: testUrl,
        },
      ]);
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("normalizes JSON content before hashing and writing", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-normalize-"));

    try {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"nested":{"ok":true}}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );

      const result = await buildInputs({ mode: "update-lock", rootDir });
      const downloadedContent = await readFile(
        path.join(rootDir, "artifacts", "source.json"),
        "utf8",
      );
      const [input] = result.inputs;

      if (!input) throw new Error("Expected a build input result");

      expect(nestedOkJsonSchema.parse(JSON.parse(downloadedContent))).toEqual({
        nested: { ok: true },
      });
      expect(downloadedContent).toBe('{ "nested": { "ok": true } }\n');
      expect(input.sha256).toBe(sha256Hex(downloadedContent));
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("rejects remote content that does not match the lock", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-lock-"));
    const lockedContent = `${JSON.stringify({ ok: true }, null, 2)}\n`;

    try {
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

      await expect(buildInputs({ mode: "materialize", rootDir })).rejects.toThrow("changed");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("defaults the public API mode to materialize", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-default-"));

    try {
      await writeBuildInputsConfig(rootDir);
      stubFetch(
        async () =>
          new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      );
      await buildInputs({ mode: "update-lock", rootDir });
      const lockfileContent = await readFile(path.join(rootDir, "build-inputs.lock.json"), "utf8");

      const result = await buildInputs({ rootDir });

      expect(result.mode).toBe("materialize");
      expect(result.lockfileUpdated).toBe(false);
      await expect(readFile(path.join(rootDir, "build-inputs.lock.json"), "utf8")).resolves.toBe(
        lockfileContent,
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("rejects duplicate URLs with different inferred formats", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-format-"));

    try {
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

      await expect(buildInputs({ mode: "update-lock", rootDir })).rejects.toThrow(
        "declared with both 'json' and 'text' formats",
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("rejects overlapping output paths", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "build-inputs-overlap-"));

    try {
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

      await expect(buildInputs({ mode: "update-lock", rootDir })).rejects.toThrow("overlaps");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("updates all file outputs sharing a selected URL", async () => {
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

      expect(result.inputs.map((input) => String(input.id))).toEqual(["source-a", "source-b"]);
      await expect(
        readFile(path.join(rootDir, "artifacts", "source-a.json"), "utf8"),
      ).resolves.toContain('"version": 2');
      await expect(
        readFile(path.join(rootDir, "artifacts", "source-b.json"), "utf8"),
      ).resolves.toContain('"version": 2');
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test("validates the rendered lock before materializing selected outputs", async () => {
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

      await expect(
        buildInputs({ ids: [buildInputId("source-json")], mode: "update-lock", rootDir }),
      ).rejects.toThrow("No lock entry exists");
      await expect(
        readFile(path.join(rootDir, "artifacts", "source.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test(
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

        await expect(
          readFile(path.join(rootDir, "artifacts", "render-cli-source", "cmd", "root.go"), "utf8"),
        ).resolves.toBe("package cmd\n");
        await expect(
          readFile(
            path.join(rootDir, "artifacts", "render-cli-source", "cmd", longArchiveFileName),
            "utf8",
          ),
        ).resolves.toBe("package cmd\n");
        await expect(
          readFile(
            path.join(rootDir, "artifacts", "render-cli-source", "pkg", "auth", "auth.go"),
            "utf8",
          ),
        ).resolves.toBe("package auth\n");
        await expect(
          readFile(
            path.join(rootDir, "artifacts", "render-cli-source", "pkg", "auth", "ignored_test.go"),
            "utf8",
          ),
        ).rejects.toThrow();
        await expect(
          readFile(path.join(rootDir, "artifacts", "render-cli-source", "README.md"), "utf8"),
        ).rejects.toThrow();

        expect(archiveResult).toMatchObject({
          id: "render-cli-source",
          path: "artifacts/render-cli-source",
          sourceSizeBytes: (await readFile(archivePath)).byteLength,
          type: "archive",
          url: archiveTestUrl,
        });
        expect(archiveResult.materializationSha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(archiveResult.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(archiveResult.sha256).toMatch(/^[0-9a-f]{64}$/u);

        const checkResult = await buildInputs({ mode: "check", rootDir });

        expect(checkResult.inputs).toEqual(updateResult.inputs);
      } finally {
        await rm(rootDir, { force: true, recursive: true });
      }
    },
  );

  test("updates all archive outputs sharing a selected URL", async () => {
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

      expect(result.inputs.map((input) => String(input.id))).toEqual([
        "render-cli-source",
        "render-cli-copy",
      ]);
      await expect(
        readFile(path.join(rootDir, "artifacts", "render-cli-source", "cmd", "root.go"), "utf8"),
      ).resolves.toContain('version = "two"');
      await expect(
        readFile(path.join(rootDir, "artifacts", "render-cli-copy", "cmd", "root.go"), "utf8"),
      ).resolves.toContain('version = "two"');
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
