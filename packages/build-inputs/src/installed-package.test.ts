import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");

void test("materializes JSON from an installed package without executables on PATH", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "build-inputs-installed-"));
  try {
    const installedPackage = path.join(root, "node_modules", "@x2zod", "build-inputs");
    const fixtureRoot = path.join(root, "project");
    await mkdir(installedPackage, { recursive: true });
    await mkdir(fixtureRoot);
    await cp(path.join(packageRoot, "src"), path.join(installedPackage, "src"), {
      recursive: true,
    });
    await cp(path.join(packageRoot, "package.json"), path.join(installedPackage, "package.json"));
    await symlink(
      path.join(packageRoot, "node_modules"),
      path.join(installedPackage, "node_modules"),
    );
    await writeFile(
      path.join(fixtureRoot, "build-inputs.json"),
      JSON.stringify({
        inputs: [
          {
            format: "json",
            id: "schema",
            path: "schema.json",
            url: "https://example.com/schema.json",
          },
        ],
        version: 1,
      }),
    );
    const script = path.join(root, "materialize.ts");
    await writeFile(
      script,
      [
        'import { buildInputs } from "@x2zod/build-inputs";',
        "globalThis.fetch = async () => new Response('{\"ok\":true}');",
        'await buildInputs({ mode: "update-lock" });',
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [script], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { PATH: "" },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixtureRoot, "schema.json"), "utf8")), {
      ok: true,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
