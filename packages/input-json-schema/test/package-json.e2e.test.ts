import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import Ajv from "ajv";

import { buildInputs } from "@x2zod/build-inputs";

import { createTemporaryDirectory } from "../../../test/native-source-harness";
import type { JsonSchemaValue, JsonValue } from "../src";
import { bunPackageSchema } from "./bun-package-schema";
import { generateSchemaFixture } from "./schema-fixture-harness";
import type { FixtureValidator } from "./schema-fixture-harness";
import {
  readSchemaStoreFixture,
  schemaStoreExternalSchemas,
  schemaStoreFixtureDirectory,
} from "./schemastore-fixtures";

const schemaStoreFixtureCount = 16;
// Full-closure compilation, declarations, and consumer subprocesses have separate deadlines.
// Leave the outer test enough time to report a phase failure and clean up on slower CI hosts.
const manifestTestTimeoutMs = 180_000;
const cacheDirectory = nodePath.join(import.meta.dirname, "../node_modules/.cache");
const packageManifest = {
  name: "x2zod-package-fixture",
  version: "1.0.0",
  private: true,
  workspaces: {
    packages: ["packages/*"],
    catalog: { "fixture-dep": "workspace:*" },
    catalogs: { local: { "fixture-dep": "workspace:*" } },
  },
  dependencies: { "fixture-dep": "catalog:local" },
  exports: { ".": "./index.js" },
  prettier: { tabWidth: 2 },
} as const satisfies JsonValue;

const packageConsumerSource = `
import type { Fixture } from "./generated";
import { fixtureSchema as parser } from "./generated";
export const parse = (value: unknown) => parser.parse(value);
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
declare const manifest: Fixture;
export type Name = Assert<Equal<typeof manifest.name, string | undefined>>;
export type Dependencies = Assert<Equal<NonNullable<Fixture["dependencies"]>[string], string>>;
export type Catalogs = Assert<Equal<NonNullable<NonNullable<Fixture["catalogs"]>[string]>[string], string>>;
export const readCatalog = (): string | undefined => {
  const workspaces = manifest.workspaces;
  return workspaces !== undefined && !Array.isArray(workspaces) ? workspaces.catalog?.["dep"] : undefined;
};
`;

const parseUnchanged = (validator: FixtureValidator, value: JsonValue): unknown => {
  const input = structuredClone(value);
  const result = validator.safeParse(input);
  assert.equal(result.success, true);
  assert.deepEqual(input, value);
  assert.deepEqual(result.data, value);
  return result.data;
};

const assertSchemaParity = ({
  schema,
  externalSchemas,
  generated,
  accepted,
  rejected,
}: Readonly<{
  schema: JsonSchemaValue;
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  generated: FixtureValidator;
  accepted: readonly JsonValue[];
  rejected: readonly JsonValue[];
}>): void => {
  const ajv = new Ajv({ strict: false, logger: false, allErrors: true, validateFormats: false });
  for (const [uri, external] of Object.entries(externalSchemas)) ajv.addSchema(external, uri);
  const validate = ajv.compile(schema);
  for (const [expected, samples] of [
    [true, accepted],
    [false, rejected],
  ] as const)
    for (const sample of samples) {
      const input = structuredClone(sample);
      assert.equal(validate(input), expected, JSON.stringify(validate.errors));
      assert.deepEqual(input, sample);
      assert.equal(generated.safeParse(input).success, expected, JSON.stringify(sample));
      assert.deepEqual(input, sample);
      if (expected) parseUnchanged(generated, sample);
    }
};

const bunInstall = (directory: string): Readonly<{ status: number | null; stderr: string }> => {
  const result = spawnSync(
    process.execPath,
    ["--no-env-file", "install", "--ignore-scripts", "--no-progress"],
    {
      cwd: directory,
      encoding: "utf8",
      env: { HOME: directory, BUN_INSTALL_CACHE_DIR: nodePath.join(directory, ".cache") },
      timeout: 10_000,
    },
  );
  if (result.error !== undefined) throw result.error;
  assert.equal(result.signal, null);
  return { status: result.status, stderr: result.stderr };
};

void test("SchemaStore manifest fixtures retain pinned full resource provenance", async () => {
  const result = await buildInputs({ mode: "check", rootDir: schemaStoreFixtureDirectory });
  assert.equal(result.lockfileUpdated, false);
  assert.equal(result.inputs.length, schemaStoreFixtureCount);
});

void test(
  "package.json compiles its real resource closure and round-trips through Bun",
  { timeout: manifestTestTimeoutMs },
  async () => {
    const directory = createTemporaryDirectory({
      prefix: "package-json-e2e-",
      rootDirectory: cacheDirectory,
    });
    try {
      const externalSchemas = schemaStoreExternalSchemas("");
      const generated = await generateSchemaFixture(directory, bunPackageSchema, {
        pluginOptions: { externalSchemas },
        consumerSource: packageConsumerSource,
      });
      assertSchemaParity({
        schema: bunPackageSchema,
        externalSchemas,
        generated,
        accepted: [
          packageManifest,
          { name: "minimal", workspaces: [] },
          {
            name: "top-level-catalog",
            catalog: { dep: "^1.0.0" },
            catalogs: { testing: { dep: "^2.0.0" } },
          },
        ],
        rejected: [
          { name: "" },
          { dependencies: { invalid: 42 } },
          { workspaces: 42 },
          { workspaces: { catalog: { dep: 42 } } },
          { catalogs: { testing: { dep: false } } },
          { prettier: { tabWidth: "two" } },
          { eslintConfig: { rules: { "no-console": "invalid" } } },
          { sideEffects: ["./same.js", "./same.js"] },
          { exports: { "./valid": 42 } },
        ],
      });
      const projectDirectory = nodePath.join(directory, "project");
      const dependencyDirectory = nodePath.join(projectDirectory, "packages/dep");
      mkdirSync(dependencyDirectory, { recursive: true });
      const dependencyManifest = {
        name: "fixture-dep",
        version: "1.0.0",
        exports: "./index.js",
        type: "module",
      } as const;
      await Promise.all([
        writeFile(
          nodePath.join(projectDirectory, "package.json"),
          JSON.stringify(parseUnchanged(generated, packageManifest)),
        ),
        writeFile(
          nodePath.join(dependencyDirectory, "package.json"),
          JSON.stringify(parseUnchanged(generated, dependencyManifest)),
        ),
        writeFile(
          nodePath.join(dependencyDirectory, "index.js"),
          'export default "local-catalog-resolved";',
        ),
      ]);
      const installed = bunInstall(projectDirectory);
      assert.equal(installed.status, 0, installed.stderr);
      const consumed = spawnSync(
        process.execPath,
        [
          "--no-env-file",
          "--eval",
          'import value from "fixture-dep"; process.stdout.write(value);',
        ],
        { cwd: projectDirectory, encoding: "utf8", timeout: 10_000 },
      );
      if (consumed.error !== undefined) throw consumed.error;
      assert.equal(consumed.status, 0, consumed.stderr);
      assert.equal(consumed.stdout, "local-catalog-resolved");

      for (const manifest of [{ dependencies: { invalid: 42 } }, { workspaces: 42 }]) {
        writeFileSync(nodePath.join(projectDirectory, "package.json"), JSON.stringify(manifest));
        assert.equal(generated.safeParse(manifest).success, false);
        assert.notEqual(bunInstall(projectDirectory).status, 0);
      }
      // Bun validates what it consumes; it is not an oracle for all SchemaStore annotations/fields.
      const badDescription = { name: "fixture", description: 42 };
      await writeFile(
        nodePath.join(projectDirectory, "package.json"),
        JSON.stringify(badDescription),
      );
      assert.equal(generated.safeParse(badDescription).success, false);
      assert.equal(bunInstall(projectDirectory).status, 0);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

void test(
  "Cargo compiles vendor metadata and real lint resources without schema surgery",
  { timeout: manifestTestTimeoutMs },
  async () => {
    const directory = createTemporaryDirectory({
      prefix: "cargo-e2e-",
      rootDirectory: cacheDirectory,
    });
    try {
      const schema = readSchemaStoreFixture("cargo.json");
      const externalSchemas = schemaStoreExternalSchemas("cargo.json");
      const generated = await generateSchemaFixture(directory, schema, {
        pluginOptions: { externalSchemas, annotationKeywords: { description: true } },
      });
      assertSchemaParity({
        schema,
        externalSchemas,
        generated,
        accepted: [
          { package: { name: "fixture", version: "0.1.0" } },
          { lints: { rust: { unsafe_code: "forbid" } } },
        ],
        rejected: [{ package: { name: 42 } }, { lints: { rust: { unsafe_code: "nonsense" } } }],
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);
