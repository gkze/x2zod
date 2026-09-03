import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import { createTemporaryDirectory, runNode } from "../../../test/native-source-harness";
import { compileGeneratedSchema } from "./generated-schema-harness";

const packageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const tempRootDirectory = nodePath.join(packageRootDirectory, ".tmp");
const typeScriptBinary = nodePath.resolve(packageRootDirectory, "../../node_modules/.bin/tsgo");
const conditionalBranchKey = ["th", "en"].join("");

void test("emits loop initializers accepted by Node native TypeScript stripping", async () => {
  const { source } = await compileGeneratedSchema({
    patternProperties: { "^x": { type: "string" } },
    type: "object",
  });
  const directory = createTemporaryDirectory({
    prefix: "x2zod-node-type-stripping-",
    rootDirectory: tempRootDirectory,
  });
  const generatedFile = nodePath.join(directory, "generated.ts");

  try {
    await writeFile(generatedFile, source);
    assert.equal(runNode({ args: [generatedFile], cwd: packageRootDirectory }), "");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

void test("emits recursive runtime metadata accepted by declaration generation", async () => {
  const schema = {
    $defs: {
      inner: {
        $id: "recursiveRef_inner.json",
        $recursiveAnchor: true,
        additionalProperties: { $recursiveRef: "#" },
      },
    },
    $id: "https://example.com/recursiveRef_main.json",
    $schema: "https://json-schema.org/draft/2019-09/schema",
    else: {
      $id: "recursiveRef_integerNode.json",
      $recursiveAnchor: true,
      $ref: "recursiveRef_inner.json",
      type: ["object", "integer"],
    },
    if: { propertyNames: { pattern: "^[a-m]" } },
    ...Object.fromEntries([
      [
        conditionalBranchKey,
        {
          $id: "recursiveRef_anyLeafNode.json",
          $recursiveAnchor: true,
          $ref: "recursiveRef_inner.json",
        },
      ],
    ]),
  };
  const { source } = await compileGeneratedSchema(schema, { dialect: "draft-2019-09" });
  const directory = createTemporaryDirectory({
    prefix: "x2zod-declaration-runtime-",
    rootDirectory: tempRootDirectory,
  });
  const generatedFile = nodePath.join(directory, "generated.ts");
  const declarationDirectory = nodePath.join(directory, "declarations");

  try {
    await writeFile(generatedFile, source);
    const result = spawnSync(
      typeScriptBinary,
      [
        "--declaration",
        "--emitDeclarationOnly",
        "--ignoreConfig",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--outDir",
        declarationDirectory,
        "--skipLibCheck",
        "--strict",
        "--target",
        "es2022",
        generatedFile,
      ],
      { cwd: packageRootDirectory, encoding: "utf8" },
    );
    assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
