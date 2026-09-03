import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isTypeScriptIdentifier, typeScriptIdentifierSchema } from "../src/typescript-identifiers";

void describe("TypeScript identifiers", () => {
  void test("rejects TypeScript tokens disallowed in exported type aliases", () => {
    for (const value of [
      "as",
      "await",
      "class",
      "default",
      "enum",
      "function",
      "private",
      "public",
      "static",
    ]) {
      assert.equal(isTypeScriptIdentifier(value), false, value);
      assert.equal(typeScriptIdentifierSchema.safeParse(value).success, false, value);
    }
  });

  void test("accepts contextual tokens and valid Unicode identifiers", () => {
    for (const value of [
      "abstract",
      "async",
      "declare",
      "from",
      "get",
      "of",
      "override",
      "readonly",
      "set",
      "satisfies",
      "using",
      "CaféConfig",
      "变量",
      "πValue",
    ]) {
      assert.equal(isTypeScriptIdentifier(value), true, value);
      assert.equal(typeScriptIdentifierSchema.safeParse(value).success, true, value);
    }
  });
});
