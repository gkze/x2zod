import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuntimeZodSchema } from "./runtime-contract";
import { runtimeGap } from "./runtime-support";

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
