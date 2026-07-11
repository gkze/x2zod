import assert from "node:assert/strict";
import { test } from "node:test";

import { validateNativeToolVersion } from "./check-native-tools";

void test("validateNativeToolVersion accepts the pinned actionlint version", () => {
  assert.doesNotThrow(() => {
    validateNativeToolVersion("actionlint", "1.7.12");
  });
});

void test("validateNativeToolVersion rejects an unpinned ShellCheck version", () => {
  assert.throws(() => {
    validateNativeToolVersion("shellcheck", "0.10.0");
  }, /Expected ShellCheck 0\.11\.0; received 0\.10\.0\./u);
});
