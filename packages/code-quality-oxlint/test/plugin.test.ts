import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import type { X2ZodOutputCodeQualityConfig } from "@x2zod/config";

import { oxlintCodeQualityPlugin } from "../src";
import type { OxlintConfig } from "../src";

const codeQuality = { oxlint: oxlintCodeQualityPlugin } as const;
const packageRoot = path.join(import.meta.dirname, "..");
const repoRoot = path.join(packageRoot, "..", "..");
const toolBin = (name: string): string =>
  path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

const withTempDirectory = async <T>(run: (directory: string) => Promise<T>): Promise<T> => {
  const tempDirectory = await mkdtemp(path.join(packageRoot, ".tmp-x2zod-oxlint-"));
  try {
    const result = await run(tempDirectory);
    return result;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
};

void test("oxlintCodeQualityPlugin types inline oxlint config only when selected", () => {
  const oxlintConfig = { rules: { eqeqeq: "error" } } satisfies OxlintConfig;
  const selected = {
    kind: "oxlint",
    options: { config: { kind: "inline", value: oxlintConfig } },
  } satisfies X2ZodOutputCodeQualityConfig<typeof codeQuality>;
  const invalid = {
    // @ts-expect-error only oxlint is available in this registry.
    kind: "oxfmt",
  } satisfies X2ZodOutputCodeQualityConfig<typeof codeQuality>;

  assert.equal(selected.kind, "oxlint");
  assert.equal(invalid.kind, "oxfmt");
});

void test("oxlintCodeQualityPlugin runs oxlint through a subprocess and returns fixed text", async () => {
  await withTempDirectory(async (directory) => {
    const outputPath = path.join(directory, "generated.ts");
    const fixed = await oxlintCodeQualityPlugin.transform(
      "let value = 1;\nexport { value };\n",
      {
        command: toolBin("oxlint"),
        config: { kind: "inline", value: { rules: { "prefer-const": "error" } } },
        fix: true,
      },
      { baseDirectory: directory, outputPath },
    );

    assert.equal(fixed, "const value = 1;\nexport { value };\n");
  });
});
