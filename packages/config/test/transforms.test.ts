import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { jsonSchemaInputPlugin } from "@x2zod/input-json-schema";

import {
  X2ZodConfigError,
  compileX2ZodTarget,
  defineConfig,
  loadX2ZodConfig,
  resolveX2ZodConfig,
} from "../src";

type AstRecord = Readonly<Record<string, unknown>>;

const plugins = { "json-schema": jsonSchemaInputPlugin } as const;
const configPackageRoot = path.join(import.meta.dirname, "..");
const camelCasePropertiesTransform = {
  kind: "map-properties",
  options: { keys: { decodedCase: "camelCase", kind: "case" } },
} as const;
const transforms = [camelCasePropertiesTransform] as const;
const snakeCaseSchemaText = JSON.stringify(
  {
    additionalProperties: false,
    properties: { user_id: { type: "string" } },
    required: ["user_id"],
    type: "object",
  },
  undefined,
  2,
);

const isAstRecord = (value: unknown): value is AstRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const declarationsFor = (statement: unknown): readonly unknown[] => {
  if (!isAstRecord(statement)) return [];
  const { declarationList } = statement;
  if (!isAstRecord(declarationList)) return [];
  const { declarations } = declarationList;
  return Array.isArray(declarations) ? declarations : [];
};

const declaredName = (declaration: unknown): string | undefined => {
  if (!isAstRecord(declaration)) return undefined;
  const { name } = declaration;
  if (!isAstRecord(name)) return undefined;
  const { text } = name;
  return typeof text === "string" ? text : undefined;
};

const callName = (declaration: unknown): string | undefined => {
  if (!isAstRecord(declaration)) return undefined;
  const { initializer } = declaration;
  if (!isAstRecord(initializer)) return undefined;
  const { expression } = initializer;
  if (!isAstRecord(expression)) return undefined;
  const { name } = expression;
  if (!isAstRecord(name)) return undefined;
  const { text } = name;
  return typeof text === "string" ? text : undefined;
};

const rootSchemaCallName = (sourceFile: Readonly<{ statements: readonly unknown[] }>): string => {
  const declaration = sourceFile.statements
    .flatMap(declarationsFor)
    .find((candidate) => declaredName(candidate) === "userSchema");
  const name = callName(declaration);
  if (name !== undefined) return name;

  throw new Error("Expected a generated userSchema call.");
};

const expectConfigError = (run: () => unknown, expectedMessage: string): void => {
  assert.throws(run, X2ZodConfigError);

  try {
    run();
  } catch (error) {
    assert.ok(error instanceof X2ZodConfigError);
    assert.ok(String(error).includes(expectedMessage));
    return;
  }

  throw new Error("Expected x2zod transform config validation to fail.");
};

const resolveInvalidTransformConfig = (): void => {
  const config = {
    plugins: { input: plugins },
    targets: {
      badTransform: {
        input: { path: "schema.json" },
        kind: "json-schema",
        output: { path: "schema.ts", typeName: "User" },
        transforms: [
          {
            kind: "map-properties",
            options: { keys: { decodedCase: "PascalCase", kind: "case" } },
          },
        ],
      },
    },
  };
  Reflect.apply(resolveX2ZodConfig, undefined, [config]);
};

void test("resolveX2ZodConfig validates and resolves target transforms", () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: plugins },
      targets: {
        user: {
          input: { path: "schema.json" },
          kind: "json-schema",
          output: { path: "generated/user.ts", typeName: "User" },
          transforms,
        },
      },
    }),
  );
  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);

  assert.deepEqual(userTarget.transforms, transforms);
});

void test("resolveX2ZodConfig defaults omitted target transforms to an empty pipeline", () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: plugins },
      targets: {
        user: {
          input: { path: "schema.json" },
          kind: "json-schema",
          output: { path: "generated/user.ts", typeName: "User" },
        },
      },
    }),
  );
  const userTarget = resolved.targets["user"];
  assert.ok(userTarget !== undefined);

  assert.deepEqual(userTarget.transforms, []);
});

void test("compileX2ZodTarget forwards resolved target transforms", async () => {
  const resolved = resolveX2ZodConfig(
    defineConfig({
      plugins: { input: plugins },
      targets: {
        user: {
          input: { id: "inline", text: snakeCaseSchemaText },
          kind: "json-schema",
          output: { path: "generated/user.ts", typeName: "User" },
          transforms,
        },
      },
    }),
  );
  const target = resolved.targets["user"];
  assert.ok(target !== undefined);

  const result = await compileX2ZodTarget({
    document: { source: { id: "inline", kind: "inline" }, text: snakeCaseSchemaText },
    target,
  });

  assert.ok(result.ok);
  assert.equal(rootSchemaCallName(result.value.sourceFile), "codec");
});

void test("resolveX2ZodConfig reports invalid nested transform options", () => {
  expectConfigError(
    resolveInvalidTransformConfig,
    "targets.badTransform.transforms.0.options.keys.decodedCase",
  );
});

void test("loadX2ZodConfig loads target transforms through c12", async () => {
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
        "    user: {",
        '      kind: "json-schema",',
        '      input: { path: "schemas/user.schema.json" },',
        '      output: { path: "generated/user.ts", typeName: "User" },',
        "      transforms: [",
        "        {",
        '          kind: "map-properties",',
        '          options: { keys: { kind: "case", decodedCase: "camelCase" } },',
        "        },",
        "      ],",
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const resolved = await loadX2ZodConfig({ cwd: tempDirectory });
    const userTarget = resolved.targets["user"];
    assert.ok(userTarget !== undefined);

    assert.deepEqual(userTarget.transforms, transforms);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});
