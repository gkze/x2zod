import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod/v4";

import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";

import {
  X2ZodConfigError,
  applyX2ZodOutputProcessors,
  defineConfig,
  resolveX2ZodConfig,
} from "../src";
import type { X2ZodOutputProcessorPlugin, X2ZodTargetFor } from "../src";

const inputPlugins = { "json-schema": jsonSchemaInputPlugin } as const;
const outputProcessors = {
  banner: {
    kind: "banner",
    optionsSchema: z.strictObject({ prefix: z.string().default("// prepared") }).readonly(),
    transform: (sourceText, options): string => [options.prefix, sourceText].join("\n"),
  } satisfies X2ZodOutputProcessorPlugin<
    Readonly<{ prefix: string }>,
    Readonly<{ prefix?: string | undefined }>,
    "banner"
  >,
  marker: {
    kind: "marker",
    optionsSchema: z.strictObject({ suffix: z.string().default("// quality") }).readonly(),
    transform: (sourceText, options): string => [sourceText, options.suffix, ""].join("\n"),
  } satisfies X2ZodOutputProcessorPlugin<
    Readonly<{ suffix: string }>,
    Readonly<{ suffix?: string | undefined }>,
    "marker"
  >,
} as const;

const expectConfigError = (run: () => unknown, expectedMessages: readonly string[]): void => {
  assert.throws(run, X2ZodConfigError);

  try {
    run();
  } catch (error) {
    assert.ok(error instanceof X2ZodConfigError);
    for (const message of expectedMessages) assert.ok(String(error).includes(message));
    return;
  }

  throw new Error("Expected x2zod config validation to fail.");
};

void test("defineConfig types target options from the output processor registry", () => {
  const target = {
    input: { path: "schema.json" },
    kind: "json-schema",
    output: {
      path: "schema.ts",
      processors: { kind: "marker", options: { suffix: "// checked" } },
      typeName: "User",
    },
  } satisfies X2ZodTargetFor<typeof inputPlugins, "json-schema", typeof outputProcessors>;

  const config = defineConfig({
    plugins: { input: inputPlugins, output: outputProcessors },
    targets: { user: target },
  });

  assert.equal(target.output.processors.kind, "marker");
  assert.equal(config.targets["user"]?.kind, "json-schema");
});

void test("resolveX2ZodConfig validates and defaults output processor options", () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: inputPlugins, output: outputProcessors },
      targets: {
        user: {
          input: { path: "schema.json" },
          kind: "json-schema",
          output: { path: "generated/user.ts", processors: { kind: "marker" }, typeName: "User" },
        },
      },
    }),
  );

  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);
  assert.ok(userTarget.output.processors !== undefined);
  assert.equal(userTarget.output.processors[0]?.kind, "marker");
  assert.deepEqual(userTarget.output.processors[0].options, { suffix: "// quality" });
});

void test("resolved output processors run in configured order", async () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: inputPlugins, output: outputProcessors },
      targets: {
        user: {
          input: { path: "schema.json" },
          kind: "json-schema",
          output: {
            path: "generated/user.ts",
            processors: [{ kind: "banner" }, { kind: "marker", options: { suffix: "// checked" } }],
            typeName: "User",
          },
        },
      },
    }),
  );

  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);
  const pipeline = userTarget.output.processors;
  assert.ok(pipeline !== undefined);
  assert.deepEqual(
    pipeline.map(({ kind, options }) => ({ kind, options })),
    [
      { kind: "banner", options: { prefix: "// prepared" } },
      { kind: "marker", options: { suffix: "// checked" } },
    ],
  );
  assert.equal(
    await applyX2ZodOutputProcessors({
      context: { baseDirectory: "/repo", outputPath: "/repo/generated/user.ts" },
      output: userTarget.output,
      sourceText: "export {};",
    }),
    "// prepared\nexport {};\n// checked\n",
  );
});

void test("copied resolved processor steps execute with their current options", async () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: inputPlugins, output: outputProcessors },
      targets: {
        user: {
          input: { path: "schema.json" },
          kind: "json-schema",
          output: {
            path: "generated/user.ts",
            processors: { kind: "marker", options: { suffix: "// original" } },
            typeName: "User",
          },
        },
      },
    }),
  );

  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);
  const step = userTarget.output.processors?.[0];
  assert.ok(step !== undefined);
  if (step.kind !== "marker") throw new Error("Expected the resolved marker processor step.");
  const output = {
    ...userTarget.output,
    processors: [{ ...step, options: { suffix: "// replaced" } }],
  };

  assert.equal(
    await applyX2ZodOutputProcessors({
      context: { baseDirectory: "/repo", outputPath: "/repo/generated/user.ts" },
      output,
      sourceText: "export {};",
    }),
    "export {};\n// replaced\n",
  );
});

void test("resolveX2ZodConfig reports unknown output processor kinds", () => {
  expectConfigError(
    () =>
      resolveX2ZodConfig({
        plugins: { input: inputPlugins, output: outputProcessors },
        targets: {
          badProcessor: {
            input: { path: "schema.json" },
            kind: "json-schema",
            output: {
              path: "generated/user.ts",
              processors: [{ kind: "unknown" }],
              typeName: "User",
            },
          },
        },
      } as never),
    ["targets.badProcessor.output.processors.0.kind: unknown output processor kind unknown"],
  );
});

void test("resolveX2ZodConfig validates output processor registry entries", () => {
  expectConfigError(
    () =>
      resolveX2ZodConfig({
        plugins: {
          input: inputPlugins,
          output: { marker: { ...outputProcessors.marker, kind: "wrong-kind" } },
        },
        targets: {},
      } as never),
    ["plugins.output.marker.kind: output processor plugin kind must match its key"],
  );
});

void test("resolveX2ZodConfig reports migration paths for legacy code quality config", () => {
  expectConfigError(
    () =>
      resolveX2ZodConfig({
        plugins: { codeQuality: outputProcessors, input: inputPlugins },
        targets: {
          legacy: {
            input: { path: "schema.json" },
            kind: "json-schema",
            output: {
              codeQuality: { kind: "marker" },
              path: "generated/user.ts",
              typeName: "User",
            },
          },
        },
      } as never),
    [
      "plugins.codeQuality: use plugins.output to register output processor plugins",
      "targets.legacy.output.codeQuality: use output.processors to select output processor plugins",
    ],
  );
});

void test("legacy code quality keys receive migration diagnostics when explicitly undefined", () => {
  expectConfigError(
    () =>
      resolveX2ZodConfig({
        plugins: { codeQuality: undefined, input: inputPlugins },
        targets: {
          legacy: {
            input: { path: "schema.json" },
            kind: "json-schema",
            output: { codeQuality: undefined, path: "generated/user.ts", typeName: "User" },
          },
        },
      } as never),
    [
      "plugins.codeQuality: use plugins.output to register output processor plugins",
      "targets.legacy.output.codeQuality: use output.processors to select output processor plugins",
    ],
  );
});
