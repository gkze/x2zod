import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import type { X2ZodOutputCodeQualityConfig } from "@x2zod/config";

import { oxlintCodeQualityPlugin } from "../src";
import type { OxlintConfig } from "../src";

type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;

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
  const invalid = { kind: "oxfmt" } as const;
  const isAssignable: IsAssignable<
    typeof invalid,
    X2ZodOutputCodeQualityConfig<typeof codeQuality>
  > = false;

  assert.equal(selected.kind, "oxlint");
  assert.equal(invalid.kind, "oxfmt");
  assert.equal(isAssignable, false);
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
