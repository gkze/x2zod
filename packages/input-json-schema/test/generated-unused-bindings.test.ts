import assert from "node:assert/strict";
import { test } from "node:test";

import { createUnusedDiagnosticMatcher } from "../src/generated-unused-bindings";

const unusedDeclaration = 6133;
const unusedPattern = 6198;
const unrelatedDiagnostic = 7006;

void test("unused diagnostics preserve containment across nested patterns and unrelated errors", () => {
  const matches = createUnusedDiagnosticMatcher([
    { code: unusedDeclaration, pos: 40, end: 45 },
    { code: unusedDeclaration, pos: 15, end: 18 },
    { code: unrelatedDiagnostic, pos: 0, end: 100 },
    { code: unusedPattern, pos: 10, end: 30 },
    { code: unusedDeclaration, pos: 15, end: 16 },
  ]);
  for (const { start, end, expected } of [
    { start: 0, end: 1, expected: false },
    { start: 9, end: 10, expected: false },
    { start: 10, end: 30, expected: true },
    { start: 19, end: 30, expected: true },
    { start: 19, end: 31, expected: false },
    { start: 31, end: 39, expected: false },
    { start: 40, end: 45, expected: true },
    { start: 40, end: 46, expected: false },
    { start: 46, end: 50, expected: false },
  ] as const)
    assert.equal(matches(start, end), expected, `${start.toString()}:${end.toString()}`);
  assert.equal(createUnusedDiagnosticMatcher([])(0, 1), false);
});
