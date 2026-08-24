import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, test } from "node:test";

import AjvDraft7 from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  runNode,
} from "../../../test/native-source-harness";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const runtimeRequirePattern = /\brequire\(["'](?<specifier>[^"']+)["']\)/gu;
const runtimeDefaultRequirePattern =
  /const (?<identifier>[A-Za-z_$][\w$]*) = require\(["'](?<specifier>[^"']+)["']\)\.default;/gu;

type StandaloneCase = Readonly<{
  acceptedValues: readonly unknown[];
  dialect: "draft-2019-09" | "draft-2020-12" | "draft-7";
  rawSource: string;
  regenerateRawSource: () => string;
  rejectedValues: readonly unknown[];
}>;

const runtimeDependencies = (source: string): readonly string[] =>
  [
    ...new Set(
      [...source.matchAll(runtimeRequirePattern)].map((match) => match.groups?.["specifier"] ?? ""),
    ),
  ].toSorted();

const prepareStandaloneSourceForBundling = (source: string): string => {
  const prepared = source.replace(
    runtimeDefaultRequirePattern,
    (_match, identifier: string, specifier: string): string =>
      [
        `import ${identifier}Module from ${JSON.stringify(`${specifier}.js`)};`,
        `const ${identifier} = ${identifier}Module.default;`,
      ].join("\n"),
  );
  assert.deepEqual(runtimeDependencies(prepared), []);
  return prepared;
};

const recursiveProperties = {
  labels: { items: { minLength: 1, type: "string" }, type: "array", uniqueItems: true },
  name: { maxLength: 1, minLength: 1, type: "string" },
  records: { items: { type: "object" }, type: "array", uniqueItems: true },
} as const;

const standaloneAjvOptions = {
  code: { esm: true, lines: true, source: true },
  logger: false,
  strict: false,
} as const;

const draft7StandaloneSource = (): string => {
  const draft7 = new AjvDraft7({ ...standaloneAjvOptions });
  const validate = draft7.compile({
    $id: "https://example.test/draft-7-node.schema.json",
    definitions: {
      node: {
        additionalProperties: false,
        properties: { ...recursiveProperties, next: { $ref: "#/definitions/node" } },
        required: ["labels", "name", "records"],
        type: "object",
      },
    },
    $ref: "#/definitions/node",
  });
  return standaloneCode(draft7, validate);
};

const draft2019StandaloneSource = (): string => {
  const draft2019 = new AjvDraft2019({ ...standaloneAjvOptions });
  const validate = draft2019.compile({
    $id: "https://example.test/draft-2019-node.schema.json",
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $recursiveAnchor: true,
    additionalProperties: false,
    properties: { ...recursiveProperties, next: { $recursiveRef: "#" } },
    required: ["labels", "name", "records"],
    type: "object",
  });
  return standaloneCode(draft2019, validate);
};

const draft2020StandaloneSource = (): string => {
  const draft2020 = new AjvDraft2020({ ...standaloneAjvOptions });
  const validate = draft2020.compile({
    $id: "https://example.test/draft-2020-node.schema.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $dynamicAnchor: "node",
    properties: { ...recursiveProperties, next: { $dynamicRef: "#node" } },
    required: ["labels", "name", "records"],
    type: "object",
    unevaluatedProperties: false,
  });
  return standaloneCode(draft2020, validate);
};

const acceptedStandaloneValues = [
  {
    labels: ["one", "two"],
    name: "😀",
    next: { labels: [], name: "🪐", records: [] },
    records: [{ id: 1 }, { id: 2 }],
  },
] as const;

const rejectedStandaloneValues = [
  { labels: [], name: "a", records: [{ id: 1 }, { id: 1 }] },
  {
    labels: [],
    name: "a",
    next: { labels: [], name: "b", records: [{ id: 1 }, { id: 1 }] },
    records: [],
  },
  { labels: [], name: "😀a", records: [] },
] as const;

const standaloneCases = (): readonly StandaloneCase[] => [
  {
    acceptedValues: acceptedStandaloneValues,
    dialect: "draft-7",
    rawSource: draft7StandaloneSource(),
    regenerateRawSource: draft7StandaloneSource,
    rejectedValues: rejectedStandaloneValues,
  },
  {
    acceptedValues: acceptedStandaloneValues,
    dialect: "draft-2019-09",
    rawSource: draft2019StandaloneSource(),
    regenerateRawSource: draft2019StandaloneSource,
    rejectedValues: rejectedStandaloneValues,
  },
  {
    acceptedValues: acceptedStandaloneValues,
    dialect: "draft-2020-12",
    rawSource: draft2020StandaloneSource(),
    regenerateRawSource: draft2020StandaloneSource,
    rejectedValues: rejectedStandaloneValues,
  },
];

const bundleStandaloneSource = (source: string): Readonly<{ first: string; second: string }> => {
  const directory = createTemporaryDirectory({
    prefix: "x2zod-ajv-standalone-",
    rootDirectory: tempRootDirectory,
  });
  const entryPoint = nodePath.join(directory, "validator.mjs");
  const firstBundle = nodePath.join(directory, "validator-first.mjs");
  const secondBundle = nodePath.join(directory, "validator-second.mjs");

  try {
    writeFileSync(entryPoint, prepareStandaloneSourceForBundling(source));
    buildNodeBundle({ cwd: packageRootDirectory, entryPoint, externals: [], outfile: firstBundle });
    buildNodeBundle({
      cwd: packageRootDirectory,
      entryPoint,
      externals: [],
      outfile: secondBundle,
    });
    return { first: readFileSync(firstBundle, "utf8"), second: readFileSync(secondBundle, "utf8") };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const runBundledValidator = (
  source: string,
  acceptedValues: readonly unknown[],
  rejectedValues: readonly unknown[],
): void => {
  const buildDirectory = createTemporaryDirectory({
    prefix: "x2zod-ajv-standalone-build-",
    rootDirectory: tempRootDirectory,
  });
  const runtimeDirectory = createTemporaryDirectory({
    prefix: "x2zod-ajv-standalone-runtime-",
    rootDirectory: tmpdir(),
  });
  const entryPoint = nodePath.join(buildDirectory, "validator.mjs");
  const bundle = nodePath.join(runtimeDirectory, "validator.bundle.mjs");
  const runner = nodePath.join(runtimeDirectory, "runner.mjs");

  try {
    writeFileSync(entryPoint, prepareStandaloneSourceForBundling(source));
    buildNodeBundle({ cwd: packageRootDirectory, entryPoint, externals: [], outfile: bundle });
    writeFileSync(
      runner,
      [
        "try {",
        '  const { default: validate } = await import("./validator.bundle.mjs");',
        '  const acceptedValues = JSON.parse(process.argv[2] ?? "null");',
        '  const rejectedValues = JSON.parse(process.argv[3] ?? "null");',
        "  for (const [index, value] of acceptedValues.entries())",
        "    if (validate(value) !== true)",
        '      throw new Error("Expected accepted fixture " + index.toString() + " to pass.");',
        "  for (const [index, value] of rejectedValues.entries())",
        "    if (validate(value) !== false)",
        '      throw new Error("Expected rejected fixture " + index.toString() + " to fail.");',
        '  process.stdout.write("ok" + String.fromCodePoint(10));',
        "} catch (error) {",
        '  const label = error instanceof Error ? error.name : "Error";',
        "  const message = error instanceof Error ? error.message : String(error);",
        '  process.stdout.write(label + ": " + message + String.fromCodePoint(10));',
        "}",
      ].join("\n"),
    );
    assert.equal(
      runNode({
        args: [runner, JSON.stringify(acceptedValues), JSON.stringify(rejectedValues)],
        cwd: runtimeDirectory,
      }),
      "ok\n",
    );
  } finally {
    rmSync(buildDirectory, { force: true, recursive: true });
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
};

void describe("Ajv standalone exact-validator backend proof", () => {
  for (const standaloneCase of standaloneCases())
    void test(`${standaloneCase.dialect} is deterministic, self-contained, and executable`, () => {
      assert.equal(standaloneCase.regenerateRawSource(), standaloneCase.rawSource);
      assert.deepEqual(runtimeDependencies(standaloneCase.rawSource), [
        "ajv/dist/runtime/equal",
        "ajv/dist/runtime/ucs2length",
      ]);

      const bundled = bundleStandaloneSource(standaloneCase.rawSource);
      assert.equal(bundled.first, bundled.second);
      assert.doesNotMatch(bundled.first, /\bfrom\s+["']ajv(?:\/|["'])/u);
      runBundledValidator(
        standaloneCase.rawSource,
        standaloneCase.acceptedValues,
        standaloneCase.rejectedValues,
      );
    });
});
