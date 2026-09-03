import {
  SyntaxKind,
  isBinaryExpression,
  isExpression,
  isForInStatement,
  isForOfStatement,
  isIdentifier,
  isNumericLiteral,
  isParameterDeclaration,
  isPrefixUnaryExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
} from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  Node,
  ParameterDeclaration,
  SourceFile,
  TypeNode,
  VariableDeclaration,
} from "@typescript/native-preview/unstable/ast";
import { getSynthesizedDeepClone } from "@typescript/native-preview/unstable/ast/clone";
import {
  createComputedPropertyName,
  createKeywordTypeNode,
  createAsExpression,
  updateParameterDeclaration,
  updatePropertyAssignment,
  updateBinaryExpression,
  updateVariableDeclaration,
} from "@typescript/native-preview/unstable/ast/factory";
import { visitEachChild, visitNode } from "@typescript/native-preview/unstable/ast/visitor";
import { API as AsyncAPI } from "@typescript/native-preview/unstable/async";
import { createVirtualFileSystem } from "@typescript/native-preview/unstable/fs";
import { API as SyncAPI } from "@typescript/native-preview/unstable/sync";

const configPath = "/__x2zod_runtime_program__/tsconfig.json";
const expressionPath = "/__x2zod_runtime_program__/expression.ts";
const expressionVariableName = "x2zodParsedExpression";
const virtualDirectory = "/__x2zod_runtime_program__";
const configSource = JSON.stringify({
  compilerOptions: { noLib: true, strict: true },
  files: ["expression.ts"],
});
const runningUnderBun = process.versions["bun"] !== undefined;

const syncVirtualFileSystem = createVirtualFileSystem({
  [configPath]: configSource,
  [expressionPath]: `const ${expressionVariableName} = true;`,
});
let syncParserApi: SyncAPI | null = null;
let syncParserInitialized = false;
let syncParserSnapshot: ReturnType<SyncAPI["updateSnapshot"]> | null = null;

const generatedSyncParserApi = (): SyncAPI => {
  syncParserApi ??= new SyncAPI({ cwd: virtualDirectory, fs: syncVirtualFileSystem });
  return syncParserApi;
};

const anyType = (): TypeNode => createKeywordTypeNode(SyntaxKind.AnyKeyword);
const numberType = (): TypeNode => createKeywordTypeNode(SyntaxKind.NumberKeyword);

const typeParameter = (parameter: ParameterDeclaration): ParameterDeclaration =>
  updateParameterDeclaration(
    parameter,
    parameter.modifiers,
    parameter.dotDotDotToken,
    parameter.name,
    parameter.questionToken,
    parameter.type ?? anyType(),
    parameter.initializer,
  );

const isForInOrOfInitializer = (declaration: VariableDeclaration): boolean =>
  isVariableDeclarationList(declaration.parent) &&
  (isForInStatement(declaration.parent.parent) || isForOfStatement(declaration.parent.parent));

const typeVariable = (declaration: VariableDeclaration, annotate: boolean): VariableDeclaration =>
  updateVariableDeclaration(
    declaration,
    declaration.name,
    declaration.exclamationToken,
    declaration.type ?? (annotate ? anyType() : undefined),
    declaration.initializer,
  );

const isNumericLiteralExpression = (node: Expression): boolean =>
  isNumericLiteral(node) ||
  (isPrefixUnaryExpression(node) &&
    (node.operator === SyntaxKind.MinusToken || node.operator === SyntaxKind.PlusToken) &&
    isNumericLiteral(node.operand));

const typeGeneratedNode = (node: Node): Node => {
  if (isParameterDeclaration(node)) return typeParameter(visitEachChild(node, typeGeneratedNode));
  if (isPropertyAssignment(node)) {
    const assignment = visitEachChild(node, typeGeneratedNode);
    return isStringLiteral(assignment.name) && assignment.name.text === "__proto__"
      ? updatePropertyAssignment(
          assignment,
          assignment.modifiers,
          createComputedPropertyName(assignment.name),
          assignment.postfixToken,
          assignment.type,
          assignment.initializer,
        )
      : assignment;
  }
  if (isVariableDeclaration(node))
    return typeVariable(visitEachChild(node, typeGeneratedNode), !isForInOrOfInitializer(node));
  if (isBinaryExpression(node)) {
    const expression = visitEachChild(node, typeGeneratedNode);
    if (
      (expression.operatorToken.kind === SyntaxKind.EqualsEqualsEqualsToken ||
        expression.operatorToken.kind === SyntaxKind.ExclamationEqualsEqualsToken) &&
      isNumericLiteralExpression(expression.left)
    )
      return updateBinaryExpression(
        expression,
        expression.modifiers,
        createAsExpression(expression.left, numberType()),
        expression.type,
        expression.operatorToken,
        expression.right,
      );
    return expression;
  }
  return visitEachChild(node, typeGeneratedNode);
};

const expressionFileSource = (source: string): string =>
  `const ${expressionVariableName} = (${source});`;

const detachedExpression = (sourceFile: SourceFile): Expression => {
  const [statement] = sourceFile.statements;
  if (statement === undefined || !isVariableStatement(statement))
    throw new Error("Generated runtime parser envelope is missing its declaration.");
  const [declaration] = statement.declarationList.declarations;
  if (
    declaration === undefined ||
    !isIdentifier(declaration.name) ||
    declaration.name.text !== expressionVariableName ||
    declaration.initializer === undefined
  )
    throw new Error("Generated runtime parser envelope has an invalid declaration.");

  const expression = visitNode(declaration.initializer, typeGeneratedNode, isExpression);
  return getSynthesizedDeepClone(expression, false);
};

const parseGeneratedExpressionSync = (source: string): Expression => {
  const { writeFile } = syncVirtualFileSystem;
  if (writeFile === undefined)
    throw new Error("Native TypeScript virtual file system is read-only.");
  writeFile(expressionPath, expressionFileSource(source));
  const previousSnapshot = syncParserSnapshot;
  const snapshot = generatedSyncParserApi().updateSnapshot(
    syncParserInitialized
      ? { fileChanges: { changed: [expressionPath] } }
      : { openProjects: [configPath] },
  );
  syncParserInitialized = true;
  syncParserSnapshot = snapshot;
  previousSnapshot?.dispose();

  const project = snapshot.getProject(configPath) ?? snapshot.getProjects()[0];
  const sourceFile = project?.program.getSourceFile(expressionPath);
  if (project === undefined || sourceFile === undefined)
    throw new Error("Native TypeScript parser did not return the generated expression file.");
  if (project.program.getSyntacticDiagnostics(expressionPath).length > 0)
    throw new Error("Generated runtime program is not syntactically valid TypeScript.");
  return detachedExpression(sourceFile);
};

const parseGeneratedExpressionAsync = async (source: string): Promise<Expression> => {
  const virtualFileSystem = createVirtualFileSystem({
    [configPath]: configSource,
    [expressionPath]: expressionFileSource(source),
  });
  const api = new AsyncAPI({ cwd: virtualDirectory, fs: virtualFileSystem });
  const snapshot = await api.updateSnapshot({ openProjects: [configPath] });

  try {
    const project = snapshot.getProject(configPath) ?? snapshot.getProjects()[0];
    const sourceFile = await project?.program.getSourceFile(expressionPath);
    if (project === undefined || sourceFile === undefined)
      throw new Error("Native TypeScript parser did not return the generated expression file.");
    const syntacticDiagnostics = await project.program.getSyntacticDiagnostics(expressionPath);
    if (syntacticDiagnostics.length > 0)
      throw new Error("Generated runtime program is not syntactically valid TypeScript.");
    return detachedExpression(sourceFile);
  } finally {
    await snapshot.dispose();
    await api.close();
  }
};

export const parseGeneratedTypeScriptExpression = async (source: string): Promise<Expression> => {
  if (!runningUnderBun) return parseGeneratedExpressionSync(source);
  const expression = await parseGeneratedExpressionAsync(source);
  return expression;
};
