import assert from "node:assert/strict";
import { test } from "node:test";

import baseConfig from "@x2zod/tsconfig/base.json" with { type: "json" };

void test("the published base config checks dependency declarations", () => {
  assert.equal(baseConfig.compilerOptions.skipLibCheck, false);
});

void test("the published base config rejects TypeScript extension rewrites", () => {
  assert.equal("allowImportingTsExtensions" in baseConfig.compilerOptions, false);
  assert.equal("rewriteRelativeImportExtensions" in baseConfig.compilerOptions, false);
});
