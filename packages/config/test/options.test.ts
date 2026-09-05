import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod/v4";

import { ok, zodFactory } from "@x2zod/core";
import type { InputPlugin } from "@x2zod/core";

import {
  compileX2ZodTarget,
  resolveX2ZodCompilableTarget,
  resolveX2ZodConfig,
  resolveX2ZodInputPluginRegistry,
} from "../src";
import type {
  X2ZodCompilableTarget,
  X2ZodLoadedOutputProcessorRegistry,
  X2ZodResolvedConfig,
  X2ZodResolvedTarget,
} from "../src";
import { withCLI } from "../src/zod-to-optique";

const optionsSchema = z.strictObject({
  name: withCLI(
    z.string().overwrite((value) => `${value}!`),
    { short: "-q" },
  ),
  tag: withCLI(
    z
      .string()
      .overwrite((value) => `${value}!`)
      .default("default"),
    { short: "-j" },
  ),
});
type Options = z.output<typeof optionsSchema>;
type OptionsInput = z.input<typeof optionsSchema>;
type ExamplePlugin = InputPlugin<string, Options, OptionsInput, "example">;
type Registry = Readonly<{ example: ExamplePlugin }>;
type Fixture = Readonly<{
  config: X2ZodResolvedConfig<Registry, X2ZodLoadedOutputProcessorRegistry>;
  plugin: ExamplePlugin;
  received: Options[];
  target: X2ZodResolvedTarget<Registry, X2ZodLoadedOutputProcessorRegistry>;
}>;

const document = { source: { kind: "inline", id: "options" }, text: "{}" } as const;
const output = { path: "unused.ts", typeName: "Options" };
const optionTransformContext = {
  baseDirectory: "/unused",
  readTextFile: async (): Promise<string> => {
    await Promise.resolve();
    throw new Error("This fixture does not load option files.");
  },
};

const fixture = (): Fixture => {
  const received: Options[] = [];
  const plugin: ExamplePlugin = {
    kind: "example",
    optionsSchema,
    prepare: async (_document, options) => {
      await Promise.resolve();
      received.push(options);
      return ok({ value: "prepared" });
    },
    lower: async (_prepared, options) => {
      await Promise.resolve();
      received.push(options);
      return ok({
        declarations: [{ expression: zodFactory("string"), symbol: "root" }],
        root: "root",
      });
    },
  };
  const config = resolveX2ZodConfig({
    plugins: { input: { example: plugin } },
    targets: {
      sample: {
        kind: "example",
        input: { id: "options", text: "{}" },
        output,
        options: { name: "name" },
      },
    },
  });
  const target = config.targets["sample"];
  assert.ok(target !== undefined);
  return { config, plugin, received, target };
};

void test("resolved target compilation does not transform options or defaults again", async () => {
  const { received, target } = fixture();
  assert.deepEqual(target.options, { name: "name!", tag: "default" });
  assert.deepEqual(target.optionsInput, { name: "name" });
  const result = await compileX2ZodTarget({ document, target });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [target.options, target.options]);
});

void test("configured CLI overrides merge into raw option inputs before parsing", async () => {
  const { config, received } = fixture();
  const { target } = await resolveX2ZodCompilableTarget({
    config,
    optionTransformContext,
    overrides: { targetName: "sample", pluginOptions: { tag: "changed" } },
  });
  const result = await compileX2ZodTarget({ document, target });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    { name: "name!", tag: "changed!" },
    { name: "name!", tag: "changed!" },
  ]);
});

void test("configured compilation without option overrides reuses resolved values", async () => {
  const { config, received } = fixture();
  const { target } = await resolveX2ZodCompilableTarget({
    config,
    optionTransformContext,
    overrides: { targetName: "sample", pluginOptions: { tag: undefined } },
  });
  const result = await compileX2ZodTarget({ document, target });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    { name: "name!", tag: "default" },
    { name: "name!", tag: "default" },
  ]);
});

void test("anonymous compilation resolves raw options once", async () => {
  const { plugin, received } = fixture();
  const pluginRegistry = resolveX2ZodInputPluginRegistry({
    plugins: { input: { example: plugin } },
  });
  const { target } = await resolveX2ZodCompilableTarget({
    optionTransformContext,
    pluginRegistry,
    overrides: {
      kind: "example",
      inlineText: "{}",
      outputPath: output.path,
      typeName: output.typeName,
      pluginOptions: { name: "anonymous" },
    },
  });
  const result = await compileX2ZodTarget({ document, target });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    { name: "anonymous!", tag: "default" },
    { name: "anonymous!", tag: "default" },
  ]);
});

void test("explicit library option inputs are validated and transformed once", async () => {
  const { received, target } = fixture();
  const invalid = await compileX2ZodTarget({ document, target, pluginOptions: null });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, "invalid_plugin_options");
  assert.deepEqual(received, []);
  const result = await compileX2ZodTarget({
    document,
    target,
    pluginOptions: { name: "override" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    { name: "override!", tag: "default" },
    { name: "override!", tag: "default" },
  ]);
});

void test("manually constructed targets still validate and transform raw options", async () => {
  const { plugin, received } = fixture();
  const target: X2ZodCompilableTarget = {
    input: { id: "options", text: "{}" },
    kind: "example",
    name: "manual",
    options: { name: "raw" },
    output,
    plugin,
  };
  const invalid = await compileX2ZodTarget({ document, target: { ...target, options: null } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, "invalid_plugin_options");
  assert.deepEqual(received, []);
  const result = await compileX2ZodTarget({ document, target });
  assert.equal(result.ok, true);
  assert.deepEqual(received, [
    { name: "raw!", tag: "default" },
    { name: "raw!", tag: "default" },
  ]);
});
