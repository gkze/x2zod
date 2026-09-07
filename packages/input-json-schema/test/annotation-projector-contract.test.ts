import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";

void test("JavaScript projectors reject asynchronous results without unhandled rejections", async () => {
  const directory = createTemporaryDirectory({
    prefix: "annotation-projector-contract-",
    rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
  });
  const entryPoint = nodePath.join(directory, "consumer.mjs");
  const outfile = nodePath.join(directory, "consumer-bundled.mjs");
  const coreEntry = nodePath.resolve(import.meta.dirname, "../../core/src");
  const pluginEntry = nodePath.resolve(import.meta.dirname, "../src");
  try {
    // JavaScript consumers can return values excluded by the public TypeScript callback contract.
    await writeFile(
      entryPoint,
      `import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { compileToZodSource } from ${JSON.stringify(coreEntry)};
import { createJsonSchemaInputPlugin } from ${JSON.stringify(pluginEntry)};

const projectors = [
  async () => ({ description: "Async docs." }),
  async () => { throw new Error("Async projector failed."); },
  () => Promise.reject(new Error("Returned promise failed.")),
  () => new Promise(() => {}),
  () => Object.create({
    then: (_resolve, reject) => reject(new Error("Inherited thenable failed.")),
  }),
];
for (const projectAnnotations of projectors) {
  const result = await compileToZodSource({
    document: {
      source: { id: "projector-contract", kind: "inline" },
      text: JSON.stringify({ type: "string", vendor: true }),
    },
    output: { typeName: "Annotated" },
    plugin: createJsonSchemaInputPlugin({ projectAnnotations }),
    pluginOptions: {},
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(diagnostic =>
    diagnostic.code === "plugin_exception" && /must return synchronously/u.test(diagnostic.message),
  ));
}
await setImmediate();
`,
    );
    buildNodeBundle({
      cwd: directory,
      entryPoint,
      externals: [...nativePreviewExternals, "jsonc-parser"],
      outfile,
    });
    runNode({
      allowedStderr: isNativePreviewShutdownStderr,
      args: ["--unhandled-rejections=strict", outfile],
      cwd: directory,
      timeoutMs: 5000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
