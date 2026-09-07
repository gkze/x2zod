import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertCLISuccess,
  cliWorkspaceTemp,
  readGeneratedText,
  runCLITest,
  withTempDirectory,
  writeConfiguredUserTarget,
} from "./fixtures";

void test("config shared output and CLI overrides select the runtime mode", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory, { runtimeMode: "shared" });
    assertCLISuccess(await runCLITest([], { cwd: directory }));
    assert.match(await readGeneratedText(directory), /@x2zod\/runtime/u);
    assertCLISuccess(
      await runCLITest(["compile", "-g", "user", "--runtime-mode", "inline"], { cwd: directory }),
    );
    assert.doesNotMatch(await readGeneratedText(directory), /@x2zod\/runtime/u);
    assertCLISuccess(
      await runCLITest(
        [
          "compile",
          "--kind",
          "json-schema",
          "-i",
          "schemas/user.schema.json",
          "-o",
          "generated/user.ts",
          "-n",
          "User",
          "--runtime-mode",
          "shared",
        ],
        { cwd: directory },
      ),
    );
    assert.match(await readGeneratedText(directory), /@x2zod\/runtime/u);
    const invalid = await runCLITest(["compile", "-g", "user", "--runtime-mode", "invalid"], {
      cwd: directory,
    });
    assert.notEqual(invalid.exitCode, 0);
  }, cliWorkspaceTemp);
});
