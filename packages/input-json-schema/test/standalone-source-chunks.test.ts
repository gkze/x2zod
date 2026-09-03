import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chunkOversizedAjvValidator } from "../src/standalone-source-chunks";

const missingIndex = -1;
const oversizedStatements = Array.from(
  { length: 3000 },
  (_unused, index) => `if (data.value${index.toString()} !== undefined) { errors++; }\n`,
).join("");

const validatorSource = (name: string, statements = oversizedStatements): string =>
  [
    `function ${name}(data: any, { instancePath = "", rootData = data }: any = {}) {`,
    ";",
    "let vErrors: any = null;",
    "let errors: any = 0;",
    'if (data && typeof data === "object") {',
    statements,
    "}",
    `(${name} as any).errors = vErrors;`,
    "return errors === 0;",
    "}",
  ].join("\n");

const dynamicAnchorsValidatorSource = (): string =>
  [
    "function validate41(data, { dynamicAnchors = {} } = {}) {",
    "let vErrors = null;",
    "let errors = 0;",
    'if (data && typeof data === "object") {',
    "dynamicAnchors.visited = true;",
    oversizedStatements,
    "}",
    "return errors === 0 && dynamicAnchors.visited === true;",
    "}",
  ].join("\n");

const nestedForValidatorSource = (): string =>
  [
    "function validate61(data) {",
    "let errors = 0;",
    'if (data && typeof data === "object") {',
    "for (const key of Object.keys(data)) {",
    oversizedStatements,
    "}",
    "}",
    "return errors === 0;",
    "}",
  ].join("\n");

void describe("Ajv standalone source chunking", () => {
  void test("chunks every oversized validator including non-default referenced definitions", () => {
    const source = [
      "function validate0(data: any) { return data !== undefined; }",
      validatorSource("validate7"),
      validatorSource("validate12"),
    ].join("\n");
    const first = chunkOversizedAjvValidator(source);
    const second = chunkOversizedAjvValidator(source);

    assert.equal(first, second);
    assert.match(first, /const x2zodvalidate7Chunk\d+ = \(\) =>/u);
    assert.match(first, /const x2zodvalidate12Chunk\d+ = \(\) =>/u);
    assert.equal(first.includes("Function("), false);
    assert.equal(/\beval\s*\(/u.test(first), false);
  });

  void test("keeps declaration prologues and their later uses in one lexical scope", () => {
    const source = validatorSource(
      "validate31",
      [
        "let required = 1;",
        "required += data.value0 === undefined ? 0 : 1;",
        oversizedStatements,
      ].join("\n"),
    );

    const rewritten = chunkOversizedAjvValidator(source);

    assert.notEqual(rewritten, source);
    assert.match(rewritten, /let required = 1;[\s\S]*const x2zodvalidate31Chunk\d+ = \(\) =>/u);
    assert.match(rewritten, /required \+= data\.value0/u);
  });

  void test("keeps validator parameters in scope for nested chunk helpers", () => {
    const source = dynamicAnchorsValidatorSource();
    const rewritten = chunkOversizedAjvValidator(source);

    assert.notEqual(rewritten, source);
    assert.match(rewritten, /const x2zodvalidate41Chunk\d+ = \(\) => \{/u);
    assert.match(rewritten, /dynamicAnchors\.visited = true;/u);
    assert.doesNotMatch(rewritten, /function x2zodvalidate41Chunk\d+\([^)]*dynamicAnchors/u);
  });

  void test("does not move statements with escaping control flow", () => {
    const source = validatorSource(
      "validate51",
      ["if (data.stop === true) return false;", oversizedStatements].join("\n"),
    );

    const rewritten = chunkOversizedAjvValidator(source);
    const helperStart = rewritten.indexOf("const x2zodvalidate51Chunk");
    const returnPosition = rewritten.indexOf("return false");

    assert.notEqual(rewritten, source);
    assert.ok(returnPosition !== missingIndex && returnPosition < helperStart);
  });

  void test("chunks a giant nested for body while keeping the loop in place", () => {
    const source = nestedForValidatorSource();
    const rewritten = chunkOversizedAjvValidator(source);

    assert.notEqual(rewritten, source);
    assert.match(
      rewritten,
      /for \(const key of Object\.keys\(data\)\) \{\s*const x2zodvalidate61Chunk\d+ = \(\) =>/u,
    );
    assert.match(rewritten, /x2zodvalidate61ChunkX*\d+\(\);\s*\n\s*\}/u);
  });
});
