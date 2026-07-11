import assert from "node:assert/strict";
import { test } from "node:test";

import { findSuppressionDirectives, isScannableFile } from "./check-no-suppressions";

void test("reports lint, format, shell, and TypeScript suppression directives", () => {
  const lintDirective = ["oxlint", "disable-next-line"].join("-");
  const formatDirective = ["prettier", "ignore"].join("-");
  const typeDirective = ["@ts", "expect-error"].join("-");
  const shellDirective = ["shellcheck", "disable"].join(" ");
  const markdownConfigureDirective = ["markdownlint", "configure-file"].join("-");
  const source = [
    `// ${lintDirective} no-debugger`,
    `// ${formatDirective}`,
    `// ${typeDirective}`,
    `# ${shellDirective}=SC2086`,
    `<!-- ${markdownConfigureDirective} { "MD013": false } -->`,
  ].join("\n");

  assert.deepEqual(findSuppressionDirectives(source), [
    { line: 1, value: lintDirective },
    { line: 2, value: formatDirective },
    { line: 3, value: typeDirective },
    { line: 4, value: shellDirective },
    { line: 5, value: markdownConfigureDirective },
  ]);
});

void test("accepts source without suppression directives", () => {
  assert.deepEqual(findSuppressionDirectives("export const value: number = 1;\n"), []);
});

void test("scans the tracked direnv script without reading dotenv secrets or build metadata", () => {
  assert.equal(isScannableFile(".envrc"), true);
  assert.equal(isScannableFile(".env"), false);
  assert.equal(isScannableFile(".env.local"), false);
  assert.equal(isScannableFile("tsconfig.tsbuildinfo"), false);
});
