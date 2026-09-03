import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeAjvStandaloneSource } from "../src/ajv-standalone-source";

void test("normalizes Ajv source lexically without rewriting literals", () => {
  const source = [
    `const literal = "foo.errors require('evil')";`,
    'const equal = require("ajv/dist/runtime/equal");',
    "export const validate0 = (data) => data;",
    "export default validate0;",
  ].join("\n");

  const analysis = analyzeAjvStandaloneSource(source);

  assert.deepEqual(analysis.runtimeDependencies, ["ajv/dist/runtime/equal"]);
  assert.match(analysis.normalizedSource, /foo\.errors require\('evil'\)/u);
  assert.match(analysis.normalizedSource, /const validate0 =/u);
  assert.match(analysis.normalizedSource, /validate0;/u);
});
