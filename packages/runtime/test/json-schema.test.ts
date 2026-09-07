import assert from "node:assert/strict";
import { test } from "node:test";

import { x2zodRequire } from "../src/json-schema";
import { x2zodEqual, x2zodUcs2Length } from "../src/json-schema-primitives";

void test("standalone dependencies preserve JSON equality and Unicode code-point length", () => {
  const equal = x2zodEqual;
  assert.equal(equal({ valueOf: 42, toString: 1 }, { toString: 1, valueOf: 42 }), true);
  assert.equal(equal([1], [2]), false);
  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.equal(equal(sparse, [1]), false);
  assert.equal(equal(sparse, [undefined]), true);
  const length = x2zodUcs2Length;
  assert.equal(length("a😀\uD800"), "a😀\uD800".length - 1);
  assert.throws(() => x2zodRequire("missing"), /Unsupported/u);
});
