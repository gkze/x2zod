import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

import {
  assertCLIConfigFailure,
  assertCLISuccess,
  binPath,
  cliWorkspaceTemp,
  draft7SchemaText,
  externalSchemaUri,
  fileExists,
  readGeneratedText,
  runCLITest,
  schemaText,
  withTempDirectory,
  writeConfiguredUserTarget,
  writeDynamicUserTarget,
  writeJsonFile,
  writeQualityUserTarget,
} from "./fixtures";

void test("runCLI compile writes generated source for anonymous JSON Schema input", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);

    const result = await runCLITest(
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
      ],
      { cwd: directory },
    );

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export const userSchema"));
    assert.ok(generated.includes("export type User = z.infer<typeof userSchema>;"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile accepts JSON Schema plugin flags from option schema metadata", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);

    const result = await runCLITest(
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
        "-d",
        "draft-7",
        "-v",
        "none",
        "-p",
        "none",
      ],
      { cwd: directory },
    );

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export type User = z.infer<typeof userSchema>;"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile help routes through the requested plugin option parser", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);

    const result = await runCLITest(["compile", "--help", "--kind", "json-schema"], {
      cwd: directory,
    });

    assertCLISuccess(result);
    assert.ok(result.stdoutText.includes("--external-schema"));
    assert.ok(result.stdoutText.includes("--source-profile"));
    assert.ok(result.stdoutText.includes("JSON Schema dialect."));
  }, cliWorkspaceTemp);
});

void test("runCLI compile loads repeatable external schemas from generated plugin flags", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);
    await writeJsonFile(path.join(directory, "schema.json"), {
      properties: { model: { $ref: [externalSchemaUri, "#/$defs/model"].join("") } },
      required: ["model"],
      type: "object",
    });
    await writeJsonFile(path.join(directory, "model.schema.json"), {
      $defs: { model: { enum: ["alpha/model", "beta/model"] } },
    });

    const result = await runCLITest(
      [
        "compile",
        "--kind",
        "json-schema",
        "-i",
        "schema.json",
        "-E",
        [externalSchemaUri, "model.schema.json"].join("="),
        "-o",
        "generated/user.ts",
        "-n",
        "User",
      ],
      { cwd: directory },
    );

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("alpha/model"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile reports missing config for anonymous input without plugin config", async () => {
  await withTempDirectory(async (directory) => {
    await writeJsonFile(path.join(directory, "schema.json"), JSON.parse(schemaText) as unknown);

    const result = await runCLITest(
      [
        "compile",
        "--kind",
        "json-schema",
        "-i",
        "schema.json",
        "-o",
        "generated/user.ts",
        "-n",
        "User",
      ],
      { cwd: directory },
    );

    assert.equal(result.exitCode, 1);
    assert.ok(result.stderrText.includes("Required config"));
  });
});

void test("runCLI compile loads dynamic plugin choices from config for anonymous input", async () => {
  await withTempDirectory(async (directory) => {
    await writeDynamicUserTarget(directory);
    await writeJsonFile(path.join(directory, "schema.json"), {
      properties: { model: { $ref: [externalSchemaUri, "#/$defs/model"].join("") } },
      required: ["model"],
      type: "object",
    });
    await writeJsonFile(path.join(directory, "model.schema.json"), {
      $defs: { model: { enum: ["alpha/model", "beta/model"] } },
    });

    const result = await runCLITest(
      [
        "compile",
        "--config",
        "x2zod.config.ts",
        "--kind",
        "openapi",
        "-i",
        "schema.json",
        "-E",
        [externalSchemaUri, "model.schema.json"].join("="),
        "-o",
        "generated/user.ts",
        "-n",
        "User",
        "-v",
        "none",
      ],
      { cwd: directory },
    );

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("alpha/model"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile help routes through configured dynamic plugin kinds", async () => {
  await withTempDirectory(async (directory) => {
    await writeDynamicUserTarget(directory);

    const result = await runCLITest(
      ["compile", "--config", "x2zod.config.ts", "--help", "--kind", "openapi"],
      { cwd: directory },
    );

    assertCLISuccess(result);
    assert.ok(result.stdoutText.includes("openapi"));
    assert.ok(result.stdoutText.includes("--validator"));
  }, cliWorkspaceTemp);
});

void test("runCLI completion script calls back into the JS runtime", async () => {
  const result = await runCLITest(["completion", "bash"]);

  assertCLISuccess(result);
  assert.ok(result.stdoutText.includes("x2zod 'completion' 'bash'"));
});

void test("runCLI completion suggestions include configured plugin option branches", async () => {
  await withTempDirectory(async (directory) => {
    await writeDynamicUserTarget(directory);

    const result = await runCLITest(
      ["completion", "bash", "compile", "--config", "x2zod.config.ts", "--kind", "openapi", "--"],
      { cwd: directory },
    );

    assertCLISuccess(result);
    assert.ok(result.stdoutText.includes("--validator"));
  }, cliWorkspaceTemp);
});

void test("runCLI with no args runs every configured target", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);

    const result = await runCLITest([], { cwd: directory });

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export type User = z.infer<typeof userSchema>;"));
  }, cliWorkspaceTemp);
});

void test("runCLI applies configured code quality tools before writing generated source", async () => {
  await withTempDirectory(async (directory) => {
    await writeQualityUserTarget(directory);

    const result = await runCLITest(["compile", "-g", "user"], { cwd: directory });

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.endsWith("// checked\n"));
  }, cliWorkspaceTemp);
});

void test("runCLI with no args reports missing config without throwing", async () => {
  await withTempDirectory(async (directory) => {
    const result = await runCLITest([], { cwd: directory });

    assertCLIConfigFailure(result);
  });
});

void test("runCLI compile can run a named target with ephemeral output overrides", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);

    const result = await runCLITest(
      ["compile", "-g", "user", "-o", "generated/account.ts", "-n", "Account"],
      { cwd: directory },
    );

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory, "generated/account.ts");
    assert.ok(generated.includes("export type Account = z.infer<typeof accountSchema>;"));
    assert.equal(await fileExists(path.join(directory, "generated", "user.ts")), false);
  }, cliWorkspaceTemp);
});

void test("runCLI compile target does not default omitted kind before resolving config", async () => {
  await withTempDirectory(async (directory) => {
    await writeDynamicUserTarget(directory);

    const result = await runCLITest(["compile", "--config", "x2zod.config.ts", "-g", "user"], {
      cwd: directory,
    });

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export type User = z.infer<typeof userSchema>;"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile target does not let plugin option defaults override config", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory, {
      options: '{ dialect: "draft-7" }',
      schemaText: draft7SchemaText,
    });

    const result = await runCLITest(["compile", "-g", "user"], { cwd: directory });

    assertCLISuccess(result);
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export type User = z.infer<typeof userSchema>;"));
  }, cliWorkspaceTemp);
});

void test("runCLI compile target reports missing config without throwing", async () => {
  await withTempDirectory(async (directory) => {
    const result = await runCLITest(["compile", "-g", "user"], { cwd: directory });

    assertCLIConfigFailure(result);
  });
});

void test("x2zod bin runs from a consumer working directory", async () => {
  await withTempDirectory(async (directory) => {
    await writeConfiguredUserTarget(directory);
    const childProcess = spawnSync(
      process.execPath,
      [
        binPath,
        "compile",
        "--kind",
        "json-schema",
        "-i",
        "schemas/user.schema.json",
        "-o",
        "generated/user.ts",
        "-n",
        "User",
      ],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    );
    if (childProcess.error !== undefined) throw childProcess.error;

    assert.equal(childProcess.status, 0);
    assert.equal(childProcess.stderr, "");
    const generated = await readGeneratedText(directory);
    assert.ok(generated.includes("export const userSchema"));
  }, cliWorkspaceTemp);
});
