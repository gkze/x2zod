import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { analyzeAjvStandaloneSource } from "../src/ajv-standalone-source";

const protectedText =
  "foo.errors foo.evaluated require('evil') (res0 = data / divisor, next) export const fake = value";
const protectedTemplate = ["`", protectedText, "`"].join("");
const protectedRegex = String.raw`/foo.errors|foo.evaluated|require('evil')|\(res0 = data \/ divisor, next\)|export const fake = value/u`;

void describe("Ajv standalone source safety", () => {
  void test("scans and normalizes executable tokens only", () => {
    const source = [
      '"use strict";',
      `const literal = "${protectedText}";`,
      `const template = ${protectedTemplate};`,
      `const regex = ${protectedRegex};`,
      `// ${protectedText}`,
      `/* ${protectedText} */`,
      'export const validate = require("ajv/dist/runtime/equal");',
      "validate.errors;",
      "validate.evaluated;",
      "if ((res0 = data / divisor, next)) return validate;",
    ].join("\n");

    const analyzed = analyzeAjvStandaloneSource(source);

    assert.deepEqual(analyzed.runtimeDependencies, ["ajv/dist/runtime/equal"]);
    assert.ok(analyzed.normalizedSource.includes(`const literal = "${protectedText}";`));
    assert.ok(analyzed.normalizedSource.includes(`const template = ${protectedTemplate};`));
    assert.ok(analyzed.normalizedSource.includes(`const regex = ${protectedRegex};`));
    assert.ok(analyzed.normalizedSource.includes(`// ${protectedText}`));
    assert.ok(analyzed.normalizedSource.includes(`/* ${protectedText} */`));
    assert.doesNotMatch(analyzed.normalizedSource, /^"use strict";/u);
    assert.match(
      analyzed.normalizedSource,
      /const validate = require\("ajv\/dist\/runtime\/equal"\);/u,
    );
    assert.match(analyzed.normalizedSource, /\(validate as any\)\.errors/u);
    assert.match(analyzed.normalizedSource, /\(validate as any\)\.evaluated/u);
    assert.match(
      analyzed.normalizedSource,
      /\(res0 = data \/ divisor, !Number\.isFinite\(res0\) \|\| next\)/u,
    );
  });
});
