import assert from "node:assert/strict";
import { test } from "node:test";

import { SyntaxKind } from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createIdentifier,
  createKeywordExpression,
  createKeywordTypeNode,
  createToken,
} from "@typescript/native-preview/unstable/ast/factory";

import { parseZodEmissionModule, zodPlan, zodRuntimeProgram } from "../src";
import {
  createSourceArrowParameter,
  createSourceFunctionCall,
  createSourcePropertyAccess,
} from "../src/source-ast";
import { sharedRuntimePrograms } from "../src/source-shared";
import { createTypeScriptIdentifierAllocator } from "../src/typescript-identifiers";

const predicate = (binding?: string): ReturnType<typeof createArrowFunction> =>
  createArrowFunction(
    undefined,
    undefined,
    [createSourceArrowParameter("value", createKeywordTypeNode(SyntaxKind.UnknownKeyword))],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    binding === undefined
      ? createKeywordExpression(SyntaxKind.TrueKeyword)
      : createSourceFunctionCall(
          createSourcePropertyAccess(createIdentifier(binding), "validate"),
          [createIdentifier("value")],
        ),
  );

const module = (
  program: ReturnType<typeof zodRuntimeProgram>,
): ReturnType<typeof parseZodEmissionModule> =>
  parseZodEmissionModule({
    root: "root",
    declarations: [
      {
        symbol: "root",
        expression: zodPlan.runtimeGuard(zodPlan.string(), "runtime", "encoded-input"),
      },
    ],
    runtimePrograms: [program],
  });

void test("shared runtime expressions must declare their dependencies and preserve the predicate ABI", () => {
  const expression = predicate();
  const valid = zodRuntimeProgram("runtime", expression, {
    expression: predicate("runtime"),
    imports: { runtime: "example-runtime" },
  });
  assert.equal(module(valid).ok, true, JSON.stringify(module(valid).diagnostics));
  assert.equal(
    module({
      ...valid,
      shared: { expression: predicate("undeclared"), imports: { runtime: "example-runtime" } },
    }).ok,
    false,
  );
  assert.equal(
    module({
      ...valid,
      shared: { expression: createKeywordExpression(SyntaxKind.TrueKeyword), imports: {} },
    }).ok,
    false,
  );
});

void test("runtime namespace imports are deduplicated and avoid reserved declaration names", () => {
  const program = zodRuntimeProgram("runtime", predicate(), {
    expression: predicate("runtime"),
    imports: { runtime: "example-runtime" },
  });
  const allocator = createTypeScriptIdentifierAllocator(["x2zodSharedRuntime"]);
  const emitted = sharedRuntimePrograms([program, { ...program, id: "second" }], allocator);
  assert.equal(emitted.imports.length, 1);
  const binding = emitted.imports[0]?.importClause?.namedBindings;
  assert.ok(binding !== undefined && "name" in binding);
  assert.notEqual(binding.name.text, "x2zodSharedRuntime");
});
