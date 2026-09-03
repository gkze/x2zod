import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { z } from "zod/v4";

import { ts } from "@x2zod/core";
import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";

import { isRecord } from "../../../test/structural";
import {
  X2ZodConfigError,
  compileX2ZodTarget,
  defineConfig,
  loadX2ZodConfig,
  loadX2ZodInputPluginRegistry,
  resolveX2ZodConfig,
  resolveX2ZodInputPluginRegistry,
} from "../src";
import type {
  X2ZodAnyInputPlugin,
  X2ZodInputPluginKey,
  X2ZodInputPluginRegistryFor,
  X2ZodTargetFor,
} from "../src";

type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;

const plugins = { "json-schema": jsonSchemaInputPlugin } as const;
const configPackageRoot = path.join(import.meta.dirname, "..");
const schemaText = JSON.stringify(
  {
    $defs: { address: { type: "string" } },
    properties: { address: { $ref: "#/$defs/address" } },
    required: ["address"],
    type: "object",
  },
  undefined,
  2,
);

const isNamedVariableStatement = (value: unknown, name: string): boolean => {
  if (!isRecord(value) || value["kind"] !== ts.SyntaxKind.VariableStatement) return false;
  const { declarationList } = value;
  if (!isRecord(declarationList) || !Array.isArray(declarationList["declarations"])) return false;
  return declarationList["declarations"].some(
    (declaration) =>
      isRecord(declaration) &&
      isRecord(declaration["name"]) &&
      declaration["name"]["text"] === name,
  );
};

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

const resolveInvalidTargetConfig = (): void => {
  resolveX2ZodConfig({
    plugins: { input: plugins },
    targets: {
      badKind: {
        input: { path: "schema.json" },
        kind: "openapi",
        output: { path: "schema.ts", typeName: "User" },
      },
      badOptions: {
        input: { path: "schema.json" },
        kind: "json-schema",
        options: { dialect: "draft-04" },
        output: { path: "schema.ts", typeName: "User" },
      },
    },
  } as never);
};

const resolveNullOptionsConfig = (): void => {
  resolveX2ZodConfig({
    plugins: { input: plugins },
    targets: {
      nullOptions: {
        input: { path: "schema.json" },
        kind: "json-schema",
        options: null,
        output: { path: "schema.ts", typeName: "User" },
      },
    },
  } as never);
};

const resolveInvalidPluginRegistryConfig = (): void => {
  resolveX2ZodConfig({
    plugins: {
      input: {
        "json-schema": {
          kind: "wrong-kind",
          lower: jsonSchemaInputPlugin.lower,
          optionsSchema: jsonSchemaInputPlugin.optionsSchema,
          prepare: jsonSchemaInputPlugin.prepare,
        },
      },
    },
    targets: {
      badOutput: {
        input: { path: "schema.json" },
        kind: "json-schema",
        output: { path: "schema.ts", typeName: "not valid" },
      },
    },
  } as never);
};

const resolveUnsupportedCLIOptionSchemaConfig = (): void => {
  resolveX2ZodInputPluginRegistry({
    plugins: {
      input: {
        bad: {
          ...jsonSchemaInputPlugin,
          kind: "bad" as const,
          optionsSchema: z.strictObject({ input: z.string() }),
        },
      },
    },
  } as never);
};

void test("defineConfig types target kinds and plugin option inputs from the plugin registry", () => {
  type PluginKey = X2ZodInputPluginKey<typeof plugins>;
  const pluginKey: PluginKey = "json-schema";

  const target = {
    input: { path: "schema.json" },
    kind: pluginKey,
    options: { dialect: "draft-7", sourceProfile: "opencode" },
    output: { path: "schema.ts", typeName: "User" },
  } satisfies X2ZodTargetFor<typeof plugins, "json-schema">;

  const config = defineConfig({ plugins: { input: plugins }, targets: { user: target } });

  assert.equal(config.targets["user"]?.kind, "json-schema");
});

void test("defineConfig rejects unknown target kinds at typecheck time", () => {
  type JsonSchemaTarget = X2ZodTargetFor<typeof plugins, "json-schema">;

  const invalidTarget = {
    input: { path: "schema.json" },
    kind: "openapi",
    output: { path: "schema.ts", typeName: "User" },
  } as const;
  const isAssignable: IsAssignable<typeof invalidTarget, JsonSchemaTarget> = false;

  assert.equal(invalidTarget.kind, "openapi");
  assert.equal(isAssignable, false);
});

void test("defineConfig rejects invalid plugin options at typecheck time", () => {
  type JsonSchemaTarget = X2ZodTargetFor<typeof plugins, "json-schema">;

  const invalidTarget = {
    input: { path: "schema.json" },
    kind: "json-schema",
    options: { dialect: "draft-04" },
    output: { path: "schema.ts", typeName: "User" },
  } as const;
  const isAssignable: IsAssignable<typeof invalidTarget, JsonSchemaTarget> = false;

  assert.equal(invalidTarget.options.dialect, "draft-04");
  assert.equal(isAssignable, false);
});

void test("defineConfig rejects plugin entries whose kind does not match their key", () => {
  const mismatchedPlugins = { openapi: jsonSchemaInputPlugin } as const;
  type MatchingRegistry = X2ZodInputPluginRegistryFor<typeof mismatchedPlugins>;
  const isAssignable: IsAssignable<
    (typeof mismatchedPlugins)["openapi"],
    MatchingRegistry["openapi"]
  > = false;

  assert.equal(isAssignable, false);
});

void test("defineConfig rejects incomplete plugin registry entries at typecheck time", () => {
  const incompletePlugin = {
    kind: "json-schema",
    optionsSchema: jsonSchemaInputPlugin.optionsSchema,
  } as const;
  const isAssignable: IsAssignable<
    typeof incompletePlugin,
    X2ZodAnyInputPlugin<"json-schema">
  > = false;

  assert.equal(isAssignable, false);
});

void test("defineConfig rejects malformed plugin hook types at typecheck time", () => {
  const malformedPlugin = {
    kind: "json-schema",
    lower: "not-a-function",
    optionsSchema: jsonSchemaInputPlugin.optionsSchema,
    prepare: "not-a-function",
  } as const;
  const isAssignable: IsAssignable<
    typeof malformedPlugin,
    X2ZodAnyInputPlugin<"json-schema">
  > = false;

  assert.equal(isAssignable, false);
});

void test("resolveX2ZodConfig validates and resolves plugin options and output defaults", () => {
  const config = defineConfig({
    plugins: { input: plugins },
    targets: {
      user: {
        input: { mediaType: "application/schema+json", path: "schema.json" },
        kind: "json-schema",
        options: { sourceProfile: "opencode" },
        output: { path: "generated/user.ts", typeName: "User" },
      },
    },
  });

  const resolved = resolveX2ZodConfig(config, { configFile: "/repo/x2zod.config.ts" });

  assert.equal(resolved.configFile, "/repo/x2zod.config.ts");
  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);
  assert.deepEqual(userTarget.input, { mediaType: "application/schema+json", path: "schema.json" });
  assert.equal(userTarget.kind, "json-schema");
  assert.equal(userTarget.name, "user");
  assert.deepEqual(userTarget.options, {
    externalSchemas: {},
    sourceProfile: "opencode",
    validator: "ajv",
  });
  assert.partialDeepStrictEqual(userTarget.output, {
    declarationExportMode: "root",
    path: "generated/user.ts",
    typeName: "User",
    zodImportPath: "zod/v4",
  });
  assert.equal(userTarget.plugin, jsonSchemaInputPlugin);
});

void test("resolveX2ZodInputPluginRegistry validates plugins without requiring targets", () => {
  const resolved = resolveX2ZodInputPluginRegistry({ plugins: { input: plugins } });

  assert.equal(resolved.plugins["json-schema"], jsonSchemaInputPlugin);
});

void test("resolveX2ZodInputPluginRegistry rejects unsupported CLI option schemas", () => {
  expectConfigError(resolveUnsupportedCLIOptionSchemaConfig, [
    "plugins.input.bad.optionsSchema: unsupported CLI option schema: input: " +
      "missing CLI option metadata",
  ]);
});

void test("compileX2ZodTarget compiles a resolved config target through the library API", async () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: plugins },
      targets: {
        user: {
          input: { id: "inline", text: schemaText },
          kind: "json-schema",
          output: {
            declarationNameOverrides: { "schema:/$defs/address": "ConfiguredSchema" },
            path: "generated/user.ts",
            typeName: "User",
          },
        },
      },
    }),
  );
  const target = resolved.targets["user"];
  if (target === undefined) throw new Error("Expected resolved user target.");

  const result = await compileX2ZodTarget({
    document: { source: { id: "inline", kind: "inline" }, text: schemaText },
    target,
  });
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));

  assert.equal(
    result.value.sourceFile.statements.some((statement) =>
      isNamedVariableStatement(statement, "configuredSchema"),
    ),
    true,
  );
});

void test("resolveX2ZodConfig reports unknown plugin kinds and invalid plugin options", () => {
  expectConfigError(resolveInvalidTargetConfig, [
    "targets.badKind.kind: unknown plugin kind openapi",
    "targets.badOptions.options.dialect",
  ]);
});

void test("resolveX2ZodConfig rejects null plugin options instead of treating them as omitted", () => {
  expectConfigError(resolveNullOptionsConfig, ["targets.nullOptions.options"]);
});

void test("resolveX2ZodConfig validates plugin registry entries and output options", () => {
  expectConfigError(resolveInvalidPluginRegistryConfig, [
    "plugins.input.json-schema.kind: plugin kind must match its key",
    "targets.badOutput.kind: unknown plugin kind json-schema",
  ]);
});

void test("loadX2ZodConfig loads x2zod.config.ts through c12 and validates it", async () => {
  const tempDirectory = await mkdtemp(path.join(configPackageRoot, ".tmp-x2zod-config-"));

  try {
    await mkdir(path.join(tempDirectory, "schemas"));
    await writeFile(
      path.join(tempDirectory, "x2zod.config.ts"),
      [
        'import { defineConfig } from "@x2zod/config";',
        'import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";',
        "",
        "export default defineConfig({",
        '  plugins: { input: { "json-schema": jsonSchemaInputPlugin } },',
        "  targets: {",
        "    user: {",
        '      kind: "json-schema",',
        '      input: { path: "schemas/user.schema.json" },',
        '      output: { path: "generated/user.ts", typeName: "User" },',
        '      options: { dialect: "draft-7" },',
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const resolved = await loadX2ZodConfig({ cwd: tempDirectory });
    const userTarget = resolved.targets["user"];
    assert.ok(userTarget !== undefined);

    assert.equal(resolved.configFile, path.join(tempDirectory, "x2zod.config.ts"));
    assert.equal(userTarget.kind, "json-schema");
    assert.deepEqual(userTarget.options, {
      dialect: "draft-7",
      externalSchemas: {},
      sourceProfile: "none",
      validator: "ajv",
    });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});

void test("loadX2ZodInputPluginRegistry loads plugins without resolving invalid targets", async () => {
  const tempDirectory = await mkdtemp(path.join(configPackageRoot, ".tmp-x2zod-config-"));

  try {
    await writeFile(
      path.join(tempDirectory, "x2zod.config.ts"),
      [
        'import { defineConfig } from "@x2zod/config";',
        'import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";',
        "",
        "export default defineConfig({",
        '  plugins: { input: { "json-schema": jsonSchemaInputPlugin } },',
        "  targets: {",
        "    badKind: {",
        '      kind: "openapi",',
        '      input: { path: "schemas/user.schema.json" },',
        '      output: { path: "generated/user.ts", typeName: "User" },',
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const resolved = await loadX2ZodInputPluginRegistry({ cwd: tempDirectory });
    assert.ok(resolved !== undefined);

    assert.equal(resolved.configFile, path.join(tempDirectory, "x2zod.config.ts"));
    assert.equal(resolved.plugins["json-schema"], jsonSchemaInputPlugin);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});
