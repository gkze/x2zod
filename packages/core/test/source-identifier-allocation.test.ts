import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SyntaxKind } from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createIdentifier,
  createKeywordExpression,
  createParameterDeclaration,
  createToken,
} from "@typescript/native-preview/unstable/ast/factory";

import {
  buildZodSourceFile,
  zodDeclaration,
  zodHelper,
  zodModule,
  zodPlan,
  zodRuntimeProgram,
  zodSymbol,
} from "../src/index";
import type { ZodEmissionModule, ts } from "../src/index";
import { variableDeclaration, variableStatements } from "./ast-helpers";

const rootSymbol = zodSymbol("root");
const outputOptions = { typeName: "User" } satisfies Parameters<typeof buildZodSourceFile>[1];
type OutputOptions = Parameters<typeof buildZodSourceFile>[1];

const sourceFileFor = (
  module: ZodEmissionModule,
  output: OutputOptions = outputOptions,
): ts.SourceFile => {
  const result = buildZodSourceFile(module, output);
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.value.sourceFile;
};

const variableNames = (sourceFile: ts.SourceFile): readonly string[] =>
  variableStatements(sourceFile).map((statement) => variableDeclaration(statement).name.text);

void describe("source identifier allocation", () => {
  void test("reserves generated helper and runtime names across declaration allocation", () => {
    const generatedNameHintSymbol = zodSymbol("generated-name-hint");
    const runtimeProgram = zodRuntimeProgram(
      "generated-predicate",
      createArrowFunction(
        undefined,
        undefined,
        [createParameterDeclaration(undefined, undefined, createIdentifier("value"))],
        undefined,
        createToken(SyntaxKind.EqualsGreaterThanToken),
        createKeywordExpression(SyntaxKind.TrueKeyword),
      ),
    );
    const module = zodModule(
      rootSymbol,
      [
        zodDeclaration(generatedNameHintSymbol, zodPlan.string()),
        zodDeclaration(
          rootSymbol,
          zodPlan.object({
            value: zodPlan.reference(generatedNameHintSymbol),
            items: zodPlan.refine(zodPlan.array(zodPlan.unknown()), zodHelper.uniqueItems()),
            guarded: zodPlan.runtimeGuard(zodPlan.string(), runtimeProgram.id, "encoded-input"),
          }),
        ),
      ],
      [runtimeProgram],
    );
    const output = {
      declarationNameOverrides: { [generatedNameHintSymbol]: "X2zodApplyRuntimePredicate" },
      typeName: "User",
    };
    const firstNames = variableNames(sourceFileFor(module, output));
    const secondNames = variableNames(sourceFileFor(module, output));

    assert.deepEqual(firstNames, secondNames);
    assert.equal(new Set(firstNames).size, firstNames.length);
    assert.ok(firstNames.includes("x2zodApplyRuntimePredicate"));
    assert.ok(firstNames.includes("x2zodJsonEqual"));
    assert.ok(firstNames.includes("x2zodUniqueItems"));
    assert.ok(firstNames.includes("x2zodRuntimeProgram0"));
  });

  void test("keeps an explicit Schema-suffixed declaration override stable", () => {
    const addressSymbol = zodSymbol("address");
    const module = zodModule(rootSymbol, [
      zodDeclaration(addressSymbol, zodPlan.string()),
      zodDeclaration(rootSymbol, zodPlan.reference(addressSymbol)),
    ]);
    const sourceFile = sourceFileFor(module, {
      declarationNameOverrides: { [addressSymbol]: "ConfiguredSchema" },
      typeName: "User",
    });

    assert.deepEqual(variableNames(sourceFile), ["configuredSchema", "userSchema"]);
  });

  void test("rejects an invalid declaration name override", () => {
    const result = buildZodSourceFile(
      zodModule(rootSymbol, [zodDeclaration(rootSymbol, zodPlan.string())]),
      { declarationNameOverrides: { [rootSymbol]: "not valid" }, typeName: "User" },
    );

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "invalid_output_options");
  });
});
