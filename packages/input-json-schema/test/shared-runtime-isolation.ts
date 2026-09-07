import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const verifySharedRuntimeIsolation = async (
  source: string,
  accepted: readonly unknown[],
  rejected: readonly unknown[],
): Promise<void> => {
  const directory = await mkdtemp(path.join(tmpdir(), "x2zod-shared-consumer-"));
  try {
    const runtime = path.join(directory, "node_modules/@x2zod/runtime");
    await mkdir(runtime, { recursive: true });
    const runtimeRoot = path.resolve(import.meta.dirname, "../../runtime");
    await Promise.all([
      cp(path.join(runtimeRoot, "src"), path.join(runtime, "src"), { recursive: true }),
      cp(path.join(runtimeRoot, "package.json"), path.join(runtime, "package.json")),
      symlink(
        path.dirname(fileURLToPath(import.meta.resolve("zod/package.json"))),
        path.join(directory, "node_modules/zod"),
        "dir",
      ),
      writeFile(path.join(directory, "generated.ts"), source),
      writeFile(
        path.join(directory, "consumer.ts"),
        [
          'import assert from "node:assert/strict";',
          'import { fixtureSchema } from "./generated";',
          "for (const value of JSON.parse(process.argv[2])) assert.deepEqual(fixtureSchema.parse(value), value);",
          "for (const value of JSON.parse(process.argv[3])) assert.equal(fixtureSchema.safeParse(value).success, false);",
        ].join("\n"),
      ),
    ]);
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        path.join(directory, "consumer.ts"),
        JSON.stringify(accepted),
        JSON.stringify(rejected),
      ],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
