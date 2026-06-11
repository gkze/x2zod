import { isRecord } from "../../../test/structural";
import type { UnknownRecord } from "../../../test/structural";
import { ts } from "../src/index";

export type IdentifierLike = Readonly<{ text: string }>;
export type ExpressionLike = UnknownRecord;
export type PropertyAccessLike = ExpressionLike &
  Readonly<{ expression: ExpressionLike; name: IdentifierLike }>;
export type CallExpressionLike = ExpressionLike &
  Readonly<{ arguments: readonly ExpressionLike[]; expression: PropertyAccessLike }>;
export type PropertyAssignmentLike = Readonly<{
  initializer: ExpressionLike;
  name: IdentifierLike;
}>;
export type ObjectLiteralLike = ExpressionLike &
  Readonly<{ properties: readonly PropertyAssignmentLike[] }>;
export type VariableDeclarationLike = Readonly<{
  initializer: ExpressionLike;
  name: IdentifierLike;
}>;
export type VariableStatementLike = Readonly<{
  declarationList: Readonly<{
    declarations: readonly [VariableDeclarationLike, ...VariableDeclarationLike[]];
  }>;
  kind: ts.SyntaxKind.VariableStatement;
  modifiers?: readonly Readonly<{ kind: ts.SyntaxKind }>[] | undefined;
}>;
export type ImportDeclarationLike = Readonly<{ moduleSpecifier: IdentifierLike }>;

const isIdentifierLike = (value: unknown): value is IdentifierLike =>
  isRecord(value) && typeof value["text"] === "string";

const isExpressionLike = (value: unknown): value is ExpressionLike => isRecord(value);

const isReadonlyArrayOf = <TValue>(
  value: unknown,
  isValue: (item: unknown) => item is TValue,
): value is readonly TValue[] => Array.isArray(value) && value.every((item) => isValue(item));

const isNonEmptyReadonlyArrayOf = <TValue>(
  value: unknown,
  isValue: (item: unknown) => item is TValue,
): value is readonly [TValue, ...TValue[]] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => isValue(item));

const isPropertyAccessLike = (value: unknown): value is PropertyAccessLike =>
  isRecord(value) && isExpressionLike(value["expression"]) && isIdentifierLike(value["name"]);

const isCallExpressionLike = (value: unknown): value is CallExpressionLike =>
  isRecord(value) &&
  isPropertyAccessLike(value["expression"]) &&
  isReadonlyArrayOf(value["arguments"], isExpressionLike);

const isPropertyAssignmentLike = (value: unknown): value is PropertyAssignmentLike =>
  isRecord(value) && isExpressionLike(value["initializer"]) && isIdentifierLike(value["name"]);

const isObjectLiteralLike = (value: unknown): value is ObjectLiteralLike =>
  isRecord(value) && isReadonlyArrayOf(value["properties"], isPropertyAssignmentLike);

const isVariableDeclarationLike = (value: unknown): value is VariableDeclarationLike =>
  isRecord(value) && isExpressionLike(value["initializer"]) && isIdentifierLike(value["name"]);

const isModifierLike = (value: unknown): value is Readonly<{ kind: ts.SyntaxKind }> =>
  isRecord(value) && typeof value["kind"] === "number";

const isVariableStatementLike = (value: unknown): value is VariableStatementLike => {
  if (!isRecord(value) || value["kind"] !== ts.SyntaxKind.VariableStatement) return false;

  const { declarationList, modifiers } = value;
  if (!isRecord(declarationList)) return false;

  return (
    isNonEmptyReadonlyArrayOf(declarationList["declarations"], isVariableDeclarationLike) &&
    (modifiers === undefined || isReadonlyArrayOf(modifiers, isModifierLike))
  );
};

const isImportDeclarationLike = (value: unknown): value is ImportDeclarationLike =>
  isRecord(value) && isIdentifierLike(value["moduleSpecifier"]);

const callExpression = (expression: ExpressionLike): CallExpressionLike => {
  if (!isCallExpressionLike(expression)) throw new Error("Expected call expression.");
  return expression;
};

const objectLiteral = (expression: ExpressionLike): ObjectLiteralLike => {
  if (!isObjectLiteralLike(expression)) throw new Error("Expected object literal.");
  return expression;
};

export const variableStatements = (sourceFile: ts.SourceFile): readonly VariableStatementLike[] => {
  const statements: VariableStatementLike[] = [];
  for (const statement of sourceFile.statements)
    if (isVariableStatementLike(statement)) statements.push(statement);

  return statements;
};

export const variableDeclaration = (statement: VariableStatementLike): VariableDeclarationLike =>
  statement.declarationList.declarations[0];

export const firstVariableDeclaration = (sourceFile: ts.SourceFile): VariableDeclarationLike => {
  const [statement] = variableStatements(sourceFile);
  if (statement === undefined) throw new Error("Missing variable statement.");

  return variableDeclaration(statement);
};

export const importPath = (sourceFile: ts.SourceFile): string => {
  const [statement] = sourceFile.statements;
  if (!isImportDeclarationLike(statement)) throw new Error("Missing import declaration.");

  return statement.moduleSpecifier.text;
};

export const zodCallName = (expression: ExpressionLike): string =>
  callExpression(expression).expression.name.text;

export const zodCallReceiverExpression = (expression: ExpressionLike): ExpressionLike =>
  callExpression(expression).expression.expression;

export const firstCallArgument = (expression: ExpressionLike): ExpressionLike => {
  const [argument] = callExpression(expression).arguments;
  if (argument === undefined) throw new Error("Missing call argument.");

  return argument;
};

export const objectProperties = (
  declaration: VariableDeclarationLike,
): readonly PropertyAssignmentLike[] =>
  objectLiteral(firstCallArgument(declaration.initializer)).properties;

export const propertyInitializer = (
  declaration: VariableDeclarationLike,
  key: string,
): ExpressionLike => {
  const property = objectProperties(declaration).find((item) => item.name.text === key);
  if (property === undefined) throw new Error(`Missing property: ${key}`);

  return property.initializer;
};
