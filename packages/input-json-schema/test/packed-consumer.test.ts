import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { z } from "zod/v4";

import { checkGeneratedConsumer } from "../../../test/generated-consumer";
import {
  buildNodeBundle,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";

const repository = path.resolve(import.meta.dirname, "../../..");
const packageNames = ["core", "input-json-schema", "runtime"] as const;
const manifestSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
});
const subprocessDeadlineMs = 30_000;

const packCompilerPackage = async (
  directory: string,
  name: (typeof packageNames)[number],
): Promise<readonly (readonly [string, string] | undefined)[]> => {
  const packageRoot = path.join(repository, "packages", name);
  const archive = path.join(directory, `${name}.tgz`);
  const packed = spawnSync(
    process.execPath,
    ["--no-env-file", "pm", "pack", "--ignore-scripts", "--quiet", "--filename", archive],
    { cwd: packageRoot, encoding: "utf8", timeout: subprocessDeadlineMs },
  );
  if (packed.error !== undefined) throw packed.error;
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  const installed = path.join(directory, "node_modules/@x2zod", name);
  await mkdir(installed, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed], {
    encoding: "utf8",
    timeout: subprocessDeadlineMs,
  });
  if (extracted.error !== undefined) throw extracted.error;
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(await realpath(installed), installed);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")),
  );
  assert.equal(manifest.name, `@x2zod/${name}`);
  return Promise.all(
    Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies }).map(
      async ([dependency, version]): Promise<readonly [string, string] | undefined> => {
        assert.equal(version.startsWith("workspace:"), false, dependency);
        if (dependency.startsWith("@x2zod/")) {
          assert.ok(
            packageNames.some((candidate) => dependency === `@x2zod/${candidate}`),
            dependency,
          );
          return undefined;
        }
        return [dependency, await realpath(path.join(packageRoot, "node_modules", dependency))];
      },
    ),
  );
};
// Pack the actual payload; dependencies use the lockfile-installed versions offline.
const installPackedCompiler = async (directory: string): Promise<void> => {
  const packages = await Promise.all(
    packageNames.map(packCompilerPackage.bind(undefined, directory)),
  );
  const dependencies = new Map<string, string>();
  for (const entry of packages.flat())
    if (entry !== undefined) {
      const previous = dependencies.get(entry[0]);
      if (previous !== undefined)
        assert.equal(previous, entry[1], `Conflicting installed dependency: ${entry[0]}`);
      dependencies.set(...entry);
    }
  await Promise.all(
    [...dependencies].map(async ([name, source]) => {
      const target = path.join(directory, "node_modules", name);
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(source, target, "dir");
    }),
  );
};

const generatePackedModules = async (directory: string): Promise<void> => {
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const generator = path.join(directory, "generate.ts");
  await writeFile(
    generator,
    [
      'import { writeFile } from "node:fs/promises";',
      'import { compileToZodSource, printSourceFile } from "@x2zod/core";',
      'import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";',
      'const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } }, propertyNames: { minLength: 2 }, additionalProperties: false };',
      'for (const runtimeMode of ["inline", "shared"]) {',
      '  const result = await compileToZodSource({ document: { source: { kind: "inline", id: "packed" }, text: JSON.stringify(schema) }, plugin: jsonSchemaInputPlugin, pluginOptions: {}, output: { typeName: "Fixture", runtimeMode } });',
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      '  await writeFile(runtimeMode + ".ts", await printSourceFile(result.value.sourceFile, { cwd: process.cwd() }));',
      "}",
    ].join("\n"),
  );
  const bundle = path.join(directory, "generate.mjs");
  buildNodeBundle({
    cwd: directory,
    entryPoint: generator,
    outfile: bundle,
    externals: [...nativePreviewExternals, "jsonc-parser"],
  });
  runNode({
    cwd: directory,
    args: [bundle],
    timeoutMs: subprocessDeadlineMs,
    allowedStderr: isNativePreviewShutdownStderr,
  });
};

const verifyPackedModule = async (
  directory: string,
  runtimeMode: "inline" | "shared",
): Promise<void> => {
  const consumer = path.join(directory, `consumer-${runtimeMode}.ts`);
  const source = [
    `import { fixtureSchema } from "./${runtimeMode}";`,
    'import type { z } from "zod/v4";',
    "type Assert<T extends true> = T;",
    "export type RequiresName = Assert<{} extends z.input<typeof fixtureSchema> ? false : true>;",
    'export const name: string = fixtureSchema.parse({ name: "ok" }).name;',
    "export const parse = (value: unknown) => fixtureSchema.parse(value);",
  ].join("\n");
  await checkGeneratedConsumer({
    cwd: directory,
    generatedFiles: [path.join(directory, `${runtimeMode}.ts`)],
    consumerFile: consumer,
    consumerSource: source,
    outputDirectory: path.join(directory, `declarations-${runtimeMode}`),
    timeoutMs: subprocessDeadlineMs,
  });
  const runner = path.join(directory, `runtime-${runtimeMode}.ts`);
  await writeFile(
    runner,
    [
      'import assert from "node:assert/strict";',
      `import { fixtureSchema } from "./${runtimeMode}";`,
      'assert.deepEqual(fixtureSchema.parse({ name: "ok" }), { name: "ok" });',
      'for (const value of [{}, { name: 1 }, { name: "ok", extra: true }]) assert.equal(fixtureSchema.safeParse(value).success, false);',
    ].join("\n"),
  );
  const result = spawnSync(process.execPath, ["--no-env-file", runner], {
    cwd: directory,
    encoding: "utf8",
    timeout: subprocessDeadlineMs,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
};

void test("packed compiler and runtime generate consumable modules outside the workspace", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "x2zod-packed-consumer-")));
  try {
    await installPackedCompiler(directory);
    await generatePackedModules(directory);
    // The generated product must run without either compiler package installed.
    await Promise.all(
      ["core", "input-json-schema"].map(async (name) => {
        await rm(path.join(directory, "node_modules/@x2zod", name), { recursive: true });
      }),
    );
    await verifyPackedModule(directory, "inline");
    await verifyPackedModule(directory, "shared");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
