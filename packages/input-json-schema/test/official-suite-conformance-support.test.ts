import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gapContractDiff,
  parseDiagnosticIdentity,
  runtimeGap,
} from "./official-suite-conformance-support";
import type { RuntimeZodSchema } from "./official-suite-conformance-support";

void test("gap manifest rejects regressions, stale entries, and failure drift", () => {
  const unsupportedDiagnostic = parseDiagnosticIdentity({
    code: "unsupported_keyword",
    message: "keyword is unsupported",
    pointer: "/unsupported",
    severity: "error",
  });
  const cyclicDiagnostic = parseDiagnosticIdentity({
    code: "cyclic_reference",
    message: "reference is cyclic",
    pointer: null,
    severity: "error",
  });
  const expected = [
    { diagnostics: [unsupportedDiagnostic], id: "known-gap", phase: "compile" },
  ] as const;
  const unexpected = [
    { diagnostics: [cyclicDiagnostic], id: "known-gap", phase: "compile" },
    { codes: ["validity_mismatch"], id: "new-gap", phase: "runtime" },
  ] as const;

  assert.deepEqual(gapContractDiff(expected, expected), { missing: [], unexpected: [] });
  assert.deepEqual(gapContractDiff([], expected), { missing: expected, unexpected: [] });
  assert.deepEqual(gapContractDiff(unexpected, expected), { missing: expected, unexpected });
});

void test("gap manifest detects diagnostic location and multiplicity drift", () => {
  const expected = [
    {
      diagnostics: [
        parseDiagnosticIdentity({
          code: "unsupported_keyword",
          message: "multipleOf is unsupported",
          pointer: "/multipleOf",
          severity: "error",
        }),
      ],
      id: "known-gap",
      phase: "compile",
    },
  ] as const;
  const moved = [
    {
      diagnostics: [
        parseDiagnosticIdentity({
          code: "unsupported_keyword",
          message: "another keyword is unsupported",
          pointer: "/anotherKeyword",
          severity: "error",
        }),
      ],
      id: "known-gap",
      phase: "compile",
    },
  ] as const;
  const duplicated = [
    { ...expected[0], diagnostics: [...expected[0].diagnostics, ...expected[0].diagnostics] },
  ] as const;

  assert.deepEqual(gapContractDiff(moved, expected), { missing: expected, unexpected: moved });
  assert.deepEqual(gapContractDiff(duplicated, expected), {
    missing: expected,
    unexpected: duplicated,
  });
});

void test("parse identity isolates fixture data and detects mutations to the parse clone", () => {
  const fixtureData = { status: "before" };
  const parseInputs: unknown[] = [];
  const schema: RuntimeZodSchema = {
    safeParse: (value) => {
      assert.notEqual(value, fixtureData);
      assert.deepEqual(value, fixtureData);
      parseInputs.push(value);
      value.status = "after";
      return { data: value, success: true };
    },
  };

  assert.deepEqual(
    runtimeGap({ data: fixtureData, expectedValid: true, id: "draft-7:identity.json:0:0", schema }),
    {
      codes: ["input_mutation"],
      detail: "schema mutated input during parsing",
      id: "draft-7:identity.json:0:0",
      phase: "runtime",
    },
  );
  assert.equal(parseInputs.length, 1);
  assert.notEqual(parseInputs[0], fixtureData);
  assert.deepEqual(fixtureData, { status: "before" });
});

void test("runtime exceptions cannot become semantic gaps", () => {
  const failure = new Error("generated validator crashed");
  const schema: RuntimeZodSchema = {
    safeParse: () => {
      throw failure;
    },
  };

  let thrown: unknown = null;
  try {
    runtimeGap({
      data: { status: "before" },
      expectedValid: true,
      id: "draft-7:crash.json:0:0",
      schema,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof Error);
  assert.match(thrown.message, /draft-7:crash\.json:0:0/u);
  assert.equal(thrown.cause, failure);
});
