import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import type { X2ZodOutputCodeQualityConfig } from "@x2zod/config";

import { oxfmtCodeQualityPlugin } from "../src";
import type { OxfmtConfig } from "../src";

const codeQuality = { oxfmt: oxfmtCodeQualityPlugin } as const;
const packageRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(packageRoot, "..", "..");
const toolBin = (name: string): string =>
  path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
const oxfmtPrintWidth = 120;

const withTempDirectory = async <T>(run: (directory: string) => Promise<T>): Promise<T> => {
  const tempDirectory = await mkdtemp(path.join(packageRoot, ".tmp-x2zod-oxfmt-"));
  try {
    const result = await run(tempDirectory);
    return result;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
};

void test("oxfmtCodeQualityPlugin types inline oxfmt config only when selected", () => {
  const oxfmtConfig = { printWidth: oxfmtPrintWidth, semi: false } satisfies OxfmtConfig;
  const selected = {
    kind: "oxfmt",
    options: { config: { kind: "inline", value: oxfmtConfig } },
  } satisfies X2ZodOutputCodeQualityConfig<typeof codeQuality>;
  const invalid = {
    // @ts-expect-error only oxfmt is available in this registry.
    kind: "oxlint",
  } satisfies X2ZodOutputCodeQualityConfig<typeof codeQuality>;

  assert.equal(selected.kind, "oxfmt");
  assert.equal(invalid.kind, "oxlint");
});

void test("oxfmtCodeQualityPlugin runs oxfmt through a subprocess with inline config", async () => {
  await withTempDirectory(async (directory) => {
    const outputPath = path.join(directory, "generated.ts");
    const formatted = await oxfmtCodeQualityPlugin.transform(
      'const value={name:"Ada"};\n',
      {
        command: toolBin("oxfmt"),
        config: { kind: "inline", value: { semi: false, singleQuote: true } },
      },
      { baseDirectory: directory, outputPath },
    );

    assert.equal(formatted, "const value = { name: 'Ada' }\n");
  });
});
