import { pathToFileURL } from "node:url";

import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createBinaryExpression,
  createBlock,
  createCallExpression,
  createIdentifier,
  createKeywordExpression,
  createKeywordTypeNode,
  createNumericLiteral,
  createParameterDeclaration,
  createParenthesizedExpression,
  createPrefixUnaryExpression,
  createPropertyAccessExpression,
  createReturnStatement,
  createStringLiteral,
  createToken,
  createTypeOfExpression,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

import { diagnosticText, requiredArgument } from "../../../test/native-print-helper";
import { isRecord } from "../../../test/structural";
import type { UnknownRecord } from "../../../test/structural";
import type {
  buildZodSourceFile,
  printSourceFileSync,
  zodDeclaration,
  zodModule,
  zodPlan,
  zodRuntimeProgram,
  zodSymbol,
} from "../src/index";

type CoreModule = Readonly<{
  buildZodSourceFile: typeof buildZodSourceFile;
  printSourceFileSync: typeof printSourceFileSync;
  zodDeclaration: typeof zodDeclaration;
  zodModule: typeof zodModule;
  zodPlan: typeof zodPlan;
  zodRuntimeProgram: typeof zodRuntimeProgram;
  zodSymbol: typeof zodSymbol;
}>;

const coreBundlePathArgumentIndex = 2;
const sourceModeArgumentIndex = 3;
const noTokenFlags = 0;
const coreModuleFunctionKeys = [
  "buildZodSourceFile",
  "printSourceFileSync",
  "zodDeclaration",
  "zodModule",
  "zodRuntimeProgram",
  "zodSymbol",
] as const satisfies readonly (keyof CoreModule)[];
const zodPlanFunctionKeys = [
  "object",
  "optional",
  "reference",
  "runtimeGuard",
  "string",
] as const satisfies readonly (keyof CoreModule["zodPlan"])[];

const hasFunctions = (value: UnknownRecord, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === "function");

const isCoreModule = (value: unknown): value is CoreModule =>
  isRecord(value) &&
  hasFunctions(value, coreModuleFunctionKeys) &&
  isRecord(value["zodPlan"]) &&
  hasFunctions(value["zodPlan"], zodPlanFunctionKeys);

const importCoreModule = async (file: string): Promise<CoreModule> => {
  const module: unknown = await import(pathToFileURL(file).href);
  if (!isCoreModule(module)) throw new Error("Core bundle did not expose the runtime program API.");
  return module;
};

const coreBundleFile = requiredArgument(coreBundlePathArgumentIndex, "core bundle");
const core = await importCoreModule(coreBundleFile);
const root = core.zodSymbol("root");
const peer = core.zodSymbol("peer");
const sourceMode = process.argv[sourceModeArgumentIndex];
const mutualRecursiveTransformMode = sourceMode === "mutual-recursive-transform";
const value = createIdentifier("value");
const isString = createBinaryExpression(
  undefined,
  createTypeOfExpression(value),
  undefined,
  createToken(SyntaxKind.EqualsEqualsEqualsToken),
  createStringLiteral("string", noTokenFlags),
);
const isAllowed = createBinaryExpression(
  undefined,
  value,
  undefined,
  createToken(SyntaxKind.ExclamationEqualsEqualsToken),
  createStringLiteral("forbidden", noTokenFlags),
);
const repeatCalls = createIdentifier("repeatCalls");
const isNotRepeat = createBinaryExpression(
  undefined,
  value,
  undefined,
  createToken(SyntaxKind.ExclamationEqualsEqualsToken),
  createStringLiteral("repeat", noTokenFlags),
);
const isFirstRepeat = createBinaryExpression(
  undefined,
  createPrefixUnaryExpression(SyntaxKind.PlusPlusToken, repeatCalls),
  undefined,
  createToken(SyntaxKind.EqualsEqualsEqualsToken),
  createNumericLiteral("1", noTokenFlags),
);
const repeatIsAllowed = createBinaryExpression(
  undefined,
  isNotRepeat,
  undefined,
  createToken(SyntaxKind.BarBarToken),
  isFirstRepeat,
);
const returnedPredicate = createArrowFunction(
  undefined,
  undefined,
  [
    createParameterDeclaration(
      undefined,
      undefined,
      value,
      undefined,
      createKeywordTypeNode(SyntaxKind.UnknownKeyword),
    ),
  ],
  createKeywordTypeNode(SyntaxKind.BooleanKeyword),
  createToken(SyntaxKind.EqualsGreaterThanToken),
  createBinaryExpression(
    undefined,
    isString,
    undefined,
    createToken(SyntaxKind.AmpersandAmpersandToken),
    createBinaryExpression(
      undefined,
      isAllowed,
      undefined,
      createToken(SyntaxKind.AmpersandAmpersandToken),
      repeatIsAllowed,
    ),
  ),
);
const predicateInitializer = createArrowFunction(
  undefined,
  undefined,
  [],
  undefined,
  createToken(SyntaxKind.EqualsGreaterThanToken),
  createBlock(
    [
      createVariableStatement(
        undefined,
        createVariableDeclarationList(
          [
            createVariableDeclaration(
              repeatCalls,
              undefined,
              undefined,
              createNumericLiteral("0", noTokenFlags),
            ),
          ],
          NodeFlags.Let,
        ),
      ),
      createReturnStatement(returnedPredicate),
    ],
    true,
  ),
);
const predicate = createCallExpression(
  createParenthesizedExpression(predicateInitializer),
  undefined,
  undefined,
  [],
  NodeFlags.None,
);
const isObject = createBinaryExpression(
  undefined,
  createTypeOfExpression(value),
  undefined,
  createToken(SyntaxKind.EqualsEqualsEqualsToken),
  createStringLiteral("object", noTokenFlags),
);
const isNotNull = createBinaryExpression(
  undefined,
  value,
  undefined,
  createToken(SyntaxKind.ExclamationEqualsEqualsToken),
  createKeywordExpression(SyntaxKind.NullKeyword),
);
const hasBlockedProperty = createCallExpression(
  createPropertyAccessExpression(
    createIdentifier("Object"),
    undefined,
    createIdentifier("hasOwn"),
    NodeFlags.None,
  ),
  undefined,
  undefined,
  [value, createStringLiteral("blocked", noTokenFlags)],
  NodeFlags.None,
);
const mutualPredicate = createArrowFunction(
  undefined,
  undefined,
  [
    createParameterDeclaration(
      undefined,
      undefined,
      value,
      undefined,
      createKeywordTypeNode(SyntaxKind.UnknownKeyword),
    ),
  ],
  createKeywordTypeNode(SyntaxKind.BooleanKeyword),
  createToken(SyntaxKind.EqualsGreaterThanToken),
  createBinaryExpression(
    undefined,
    isObject,
    undefined,
    createToken(SyntaxKind.AmpersandAmpersandToken),
    createBinaryExpression(
      undefined,
      isNotNull,
      undefined,
      createToken(SyntaxKind.AmpersandAmpersandToken),
      createPrefixUnaryExpression(SyntaxKind.ExclamationToken, hasBlockedProperty),
    ),
  ),
);
const program = core.zodRuntimeProgram(
  "root-predicate",
  mutualRecursiveTransformMode ? mutualPredicate : predicate,
);
const guarded = (
  expression: Parameters<typeof core.zodPlan.runtimeGuard>[0],
): ReturnType<typeof core.zodPlan.runtimeGuard> =>
  core.zodPlan.runtimeGuard(expression, program.id, "encoded-input");
const module = mutualRecursiveTransformMode
  ? core.zodModule(
      root,
      [
        core.zodDeclaration(
          root,
          guarded(
            core.zodPlan.object({
              peer: core.zodPlan.optional(core.zodPlan.reference(peer)),
              root_label: core.zodPlan.string(),
            }),
          ),
        ),
        core.zodDeclaration(
          peer,
          guarded(
            core.zodPlan.object({
              peer_label: core.zodPlan.string(),
              root: core.zodPlan.optional(core.zodPlan.reference(root)),
            }),
          ),
        ),
      ],
      [program],
    )
  : core.zodModule(root, [core.zodDeclaration(root, guarded(core.zodPlan.string()))], [program]);
const result = core.buildZodSourceFile(
  module,
  { declarationExportMode: mutualRecursiveTransformMode ? "all" : "root", typeName: "User" },
  mutualRecursiveTransformMode
    ? [{ kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } }]
    : [],
);
if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

process.stdout.write(core.printSourceFileSync(result.value.sourceFile, { cwd: process.cwd() }));
