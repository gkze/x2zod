import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type { Expression } from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createBlock,
  createCallExpression,
  createFunctionExpression,
  createIdentifier,
  createIfStatement,
  createKeywordExpression,
  createKeywordTypeNode,
  createParameterDeclaration,
  createParenthesizedExpression,
  createPropertyAccessExpression,
  createReturnStatement,
  createStringLiteral,
  createToken,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

import { isRecord } from "../../../test/structural";
import {
  buildZodSourceFile,
  ts,
  zodDeclaration,
  zodDeclarationNameHint,
  zodModule,
  zodPlan,
  zodRuntimeProgram,
  zodRuntimeProgramSchema,
  zodSymbol,
} from "../src/index";
import type { ZodEmissionModule, ZodRuntimeProgram } from "../src/index";
import { variableDeclaration, variableStatements } from "./ast-helpers";

const rootSymbol = zodSymbol("root");
const defaultOutputOptions = { typeName: "User" } satisfies Parameters<
  typeof buildZodSourceFile
>[1];
const runtimePredicate = (result: SyntaxKind.TrueKeyword | SyntaxKind.FalseKeyword): Expression =>
  createArrowFunction(
    undefined,
    undefined,
    [
      createParameterDeclaration(
        undefined,
        undefined,
        createIdentifier("value"),
        undefined,
        createKeywordTypeNode(SyntaxKind.UnknownKeyword),
      ),
    ],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createKeywordExpression(result),
  );

const runtimeProgram = (
  id: string,
  result: SyntaxKind.TrueKeyword | SyntaxKind.FalseKeyword,
): ZodRuntimeProgram => zodRuntimeProgram(id, runtimePredicate(result));

const runtimeProgramResult = (
  id: string,
  expression: Expression,
): ReturnType<typeof buildZodSourceFile> =>
  buildZodSourceFile(
    zodModule(
      rootSymbol,
      [zodDeclaration(rootSymbol, zodPlan.runtimeGuard(zodPlan.unknown(), id, "encoded-input"))],
      [zodRuntimeProgram(id, expression)],
    ),
    defaultOutputOptions,
  );

const arrowPredicate = (body: Expression): Expression =>
  createArrowFunction(
    undefined,
    undefined,
    [createParameterDeclaration(undefined, undefined, createIdentifier("value"))],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    body,
  );

const createRuntimeCall = (expression: Expression, args: readonly Expression[] = []): Expression =>
  createCallExpression(expression, undefined, undefined, args, NodeFlags.None);

const initializedPredicate = (
  setup: readonly ReturnType<typeof createVariableStatement>[],
  returned: Expression,
  args: readonly Expression[] = [],
): Expression =>
  createRuntimeCall(
    createParenthesizedExpression(
      createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        createToken(SyntaxKind.EqualsGreaterThanToken),
        createBlock([...setup, createReturnStatement(returned)], true),
      ),
    ),
    args,
  );

const sourceFileFor = (module: ZodEmissionModule): ts.SourceFile => {
  const result = buildZodSourceFile(module, defaultOutputOptions);
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.value.sourceFile;
};

const variableNames = (sourceFile: ts.SourceFile): readonly string[] =>
  variableStatements(sourceFile).map((statement) => variableDeclaration(statement).name.text);

const runtimeProgramBodyKinds = (sourceFile: ts.SourceFile): readonly unknown[] =>
  variableStatements(sourceFile)
    .filter((statement) =>
      /^x2zodRuntimeProgram\d+$/u.test(variableDeclaration(statement).name.text),
    )
    .map((statement) => {
      const { initializer } = variableDeclaration(statement);
      if (!isRecord(initializer) || !isRecord(initializer["body"]))
        throw new Error("Expected a runtime program arrow function.");
      return initializer["body"]["kind"];
    });

void describe("runtime program validation", () => {
  void test("rejects a runtime guard that references an undeclared program", () => {
    const result = buildZodSourceFile(
      zodModule(rootSymbol, [
        zodDeclaration(
          rootSymbol,
          zodPlan.runtimeGuard(zodPlan.string(), "missing-program", "encoded-input"),
        ),
      ]),
      defaultOutputOptions,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    assert.match(result.diagnostics[0].message, /missing-program/u);
  });

  void test("rejects duplicate runtime program IDs", () => {
    const program = runtimeProgram("duplicate-program", SyntaxKind.TrueKeyword);
    const result = buildZodSourceFile(
      zodModule(
        rootSymbol,
        [
          zodDeclaration(
            rootSymbol,
            zodPlan.runtimeGuard(zodPlan.string(), program.id, "encoded-input"),
          ),
        ],
        [program, program],
      ),
      defaultOutputOptions,
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    assert.match(result.diagnostics[0].message, /duplicate-program/u);
  });

  void test("returns a diagnostic for an invalid runtime program AST input", () => {
    const result = zodRuntimeProgramSchema.safeParse({
      expression: { kind: SyntaxKind.ArrowFunction },
      id: "invalid-program",
    });

    if (result.success) throw new Error("Expected invalid runtime program AST input.");
    const [issue] = result.error.issues;
    if (issue === undefined) throw new Error("Missing invalid AST diagnostic.");
    assert.match(issue.message, /Runtime program expression/u);
  });

  void test("rejects predicates that do not implement the unknown-to-boolean ABI", () => {
    const invalidPredicate = createArrowFunction(
      undefined,
      undefined,
      [
        createParameterDeclaration(
          undefined,
          undefined,
          createIdentifier("value"),
          undefined,
          createKeywordTypeNode(SyntaxKind.NumberKeyword),
        ),
      ],
      createKeywordTypeNode(SyntaxKind.StringKeyword),
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createStringLiteral("yes", 0),
    );
    const result = runtimeProgramResult("invalid-abi", invalidPredicate);

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    assert.match(result.diagnostics[0].message, /\(unknown\) => boolean/u);
  });
});

void describe("runtime program lexical closure validation", () => {
  void test("rejects a bare undeclared runtime dependency through module validation", () => {
    const result = runtimeProgramResult("bare-dependency", createIdentifier("externalValidator"));

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    assert.match(result.diagnostics[0].message, /synchronous predicate function/u);
  });

  void test("rejects unresolved identifiers nested inside lexical functions", () => {
    const value = createIdentifier("value");
    const nested = createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createRuntimeCall(createIdentifier("externalValidator"), [value]),
    );
    const result = runtimeProgramResult(
      "nested-dependency",
      arrowPredicate(createRuntimeCall(createParenthesizedExpression(nested))),
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
    assert.match(result.diagnostics[0].message, /externalValidator/u);
  });

  void test("rejects ambient and module-loading mechanisms", () => {
    const cases = [
      {
        expression: arrowPredicate(
          createRuntimeCall(createKeywordExpression(SyntaxKind.ImportKeyword), [
            createStringLiteral("external-module", 0),
          ]),
        ),
        expected: /dynamic import/u,
        id: "dynamic-import",
      },
      {
        expression: arrowPredicate(createIdentifier("globalThis")),
        expected: /globalThis/u,
        id: "ambient-global",
      },
      {
        expression: arrowPredicate(
          createRuntimeCall(createIdentifier("require"), [
            createStringLiteral("external-module", 0),
          ]),
        ),
        expected: /require/u,
        id: "module-loader",
      },
    ] as const;

    for (const runtimeCase of cases) {
      const result = runtimeProgramResult(runtimeCase.id, runtimeCase.expression);
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
      assert.match(result.diagnostics[0].message, runtimeCase.expected);
    }
  });

  void test("accepts lexical bindings and documented ECMAScript intrinsic globals", () => {
    const value = createIdentifier("value");
    const local = createIdentifier("local");
    const nested = createArrowFunction(
      undefined,
      undefined,
      [createParameterDeclaration(undefined, undefined, local)],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createRuntimeCall(
        createPropertyAccessExpression(
          createIdentifier("Array"),
          undefined,
          createIdentifier("isArray"),
          NodeFlags.None,
        ),
        [local],
      ),
    );
    const result = runtimeProgramResult(
      "intrinsic-and-lexical",
      arrowPredicate(createRuntimeCall(createParenthesizedExpression(nested), [value])),
    );

    assert.equal(result.ok, true);
  });
});

void describe("initialized runtime predicate validation", () => {
  void test("accepts a bounded initializer that returns a predicate capturing local setup", () => {
    const localValidator = createIdentifier("localValidator");
    const input = createIdentifier("input");
    const localFunction = createFunctionExpression(
      undefined,
      undefined,
      undefined,
      undefined,
      [createParameterDeclaration(undefined, undefined, input)],
      createKeywordTypeNode(SyntaxKind.BooleanKeyword),
      createBlock([createReturnStatement(createKeywordExpression(SyntaxKind.TrueKeyword))], true),
    );
    const setup = createVariableStatement(
      undefined,
      createVariableDeclarationList(
        [createVariableDeclaration(localValidator, undefined, undefined, localFunction)],
        NodeFlags.Const,
      ),
    );
    const returned = arrowPredicate(createRuntimeCall(localValidator, [createIdentifier("value")]));
    const result = runtimeProgramResult(
      "initialized-predicate",
      initializedPredicate([setup], returned),
    );

    assert.equal(result.ok, true);
  });

  void test("rejects initializer calls outside the bounded one-time setup grammar", () => {
    const localPredicate = createIdentifier("localPredicate");
    const setup = createVariableStatement(
      undefined,
      createVariableDeclarationList(
        [
          createVariableDeclaration(
            localPredicate,
            undefined,
            undefined,
            arrowPredicate(createKeywordExpression(SyntaxKind.TrueKeyword)),
          ),
        ],
        NodeFlags.Const,
      ),
    );
    const returnedIdentifier = runtimeProgramResult(
      "returned-identifier",
      initializedPredicate([setup], localPredicate),
    );
    const calledWithArgument = runtimeProgramResult(
      "initializer-argument",
      initializedPredicate([], arrowPredicate(createKeywordExpression(SyntaxKind.TrueKeyword)), [
        createKeywordExpression(SyntaxKind.TrueKeyword),
      ]),
    );
    const conditionalReturnFactory = createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createBlock(
        [
          createIfStatement(
            createKeywordExpression(SyntaxKind.TrueKeyword),
            createReturnStatement(arrowPredicate(createKeywordExpression(SyntaxKind.TrueKeyword))),
          ),
          createReturnStatement(arrowPredicate(createKeywordExpression(SyntaxKind.TrueKeyword))),
        ],
        true,
      ),
    );
    const conditionalReturn = runtimeProgramResult(
      "conditional-return",
      createRuntimeCall(createParenthesizedExpression(conditionalReturnFactory)),
    );

    for (const result of [returnedIdentifier, calledWithArgument, conditionalReturn]) {
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics[0].code, "invalid_zod_emission_module");
      assert.match(result.diagnostics[0].message, /zero-argument initializer/u);
    }
  });
});

void describe("runtime program source emission", () => {
  void test("orders programs and resolves names deterministically", () => {
    const alpha = runtimeProgram("alpha", SyntaxKind.TrueKeyword);
    const zeta = runtimeProgram("zeta", SyntaxKind.FalseKeyword);
    const auxiliary = zodSymbol("auxiliary");
    const makeModule = (
      programs: readonly ReturnType<typeof runtimeProgram>[],
    ): ZodEmissionModule =>
      zodModule(
        rootSymbol,
        [
          zodDeclaration(auxiliary, zodPlan.string(), [
            zodDeclarationNameHint("X2zodRuntimeProgram0"),
          ]),
          zodDeclaration(
            rootSymbol,
            zodPlan.runtimeGuard(zodPlan.reference(auxiliary), alpha.id, "encoded-input"),
          ),
        ],
        programs,
      );

    const first = sourceFileFor(makeModule([zeta, alpha]));
    const second = sourceFileFor(makeModule([alpha, zeta]));

    assert.deepEqual(variableNames(first), variableNames(second));
    assert.deepEqual(runtimeProgramBodyKinds(first), [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
    ]);
    assert.deepEqual(runtimeProgramBodyKinds(first), runtimeProgramBodyKinds(second));
    assert.deepEqual(variableNames(first), [
      "x2zodApplyRuntimePredicate",
      "x2zodRuntimeProgram0",
      "x2zodRuntimeProgram1",
      "x2zodRuntimeProgram0Schema",
      "userSchema",
    ]);
    assert.equal(
      new Set(variableNames(first)).size,
      variableNames(first).length,
      "schema and runtime program names must not collide",
    );
  });
});
