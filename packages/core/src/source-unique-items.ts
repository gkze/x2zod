import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  BinaryOperator,
  BindingName,
  Expression,
  ParameterDeclaration,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayTypeNode,
  createArrowFunction,
  createAsExpression,
  createBinaryExpression,
  createBlock,
  createCallExpression,
  createElementAccessExpression,
  createIdentifier,
  createIfStatement,
  createKeywordExpression,
  createKeywordTypeNode,
  createParameterDeclaration,
  createPropertyAccessExpression,
  createReturnStatement,
  createStringLiteral,
  createToken,
  createTypeOfExpression,
  createTypeOperatorNode,
  createTypeReferenceNode,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

const noTokenFlags = 0;
const jsonEqualHelperName = "x2zodJsonEqual";
export const uniqueItemsHelperName = "x2zodUniqueItems";

const createArrowParameter = (name: string, type?: TypeNode): ParameterDeclaration =>
  createParameterDeclaration(undefined, undefined, createIdentifier(name), undefined, type);

const createPropertyAccess = (expression: Expression, name: string): Expression =>
  createPropertyAccessExpression(expression, undefined, createIdentifier(name), NodeFlags.None);

const createElementAccess = (expression: Expression, key: Expression): Expression =>
  createElementAccessExpression(expression, undefined, key, NodeFlags.None);

const createFunctionCall = (expression: Expression, args: readonly Expression[]): Expression =>
  createCallExpression(expression, undefined, undefined, args, NodeFlags.None);

const createBinary = (left: Expression, operator: BinaryOperator, right: Expression): Expression =>
  createBinaryExpression(undefined, left, undefined, createToken(operator), right);

const createConstStatement = (name: BindingName, initializer: Expression): VariableStatement =>
  createVariableStatement(
    undefined,
    createVariableDeclarationList(
      [createVariableDeclaration(name, undefined, undefined, initializer)],
      NodeFlags.Const,
    ),
  );

const createIsArray = (expression: Expression): Expression =>
  createFunctionCall(createPropertyAccess(createIdentifier("Array"), "isArray"), [expression]);

const createObjectMismatch = (left: Expression, right: Expression): Expression => {
  const nullExpression = createKeywordExpression(SyntaxKind.NullKeyword);
  const isNotObject = (expression: Expression): Expression =>
    createBinary(
      createTypeOfExpression(expression),
      SyntaxKind.ExclamationEqualsEqualsToken,
      createStringLiteral("object", noTokenFlags),
    );
  const isNull = (expression: Expression): Expression =>
    createBinary(expression, SyntaxKind.EqualsEqualsEqualsToken, nullExpression);

  return createBinary(
    createBinary(isNotObject(left), SyntaxKind.BarBarToken, isNull(left)),
    SyntaxKind.BarBarToken,
    createBinary(isNotObject(right), SyntaxKind.BarBarToken, isNull(right)),
  );
};

const createArrayEquality = (left: Expression, right: Expression): Expression => {
  const value = createIdentifier("value");
  const index = createIdentifier("index");
  const sameLength = createBinary(
    createPropertyAccess(left, "length"),
    SyntaxKind.EqualsEqualsEqualsToken,
    createPropertyAccess(right, "length"),
  );
  const sameElements = createFunctionCall(createPropertyAccess(left, "every"), [
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("value"), createArrowParameter("index")],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createFunctionCall(createIdentifier(jsonEqualHelperName), [
        value,
        createElementAccess(right, index),
      ]),
    ),
  ]);

  return createBinary(
    createBinary(
      createBinary(createIsArray(left), SyntaxKind.AmpersandAmpersandToken, createIsArray(right)),
      SyntaxKind.AmpersandAmpersandToken,
      sameLength,
    ),
    SyntaxKind.AmpersandAmpersandToken,
    sameElements,
  );
};

const createObjectEquality = (leftRecord: Expression, rightRecord: Expression): Expression => {
  const leftKeys = createIdentifier("leftKeys");
  const rightKeys = createIdentifier("rightKeys");
  const key = createIdentifier("key");
  const sameKeyCount = createBinary(
    createPropertyAccess(leftKeys, "length"),
    SyntaxKind.EqualsEqualsEqualsToken,
    createPropertyAccess(rightKeys, "length"),
  );
  const sameProperties = createFunctionCall(createPropertyAccess(leftKeys, "every"), [
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("key")],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createBinary(
        createFunctionCall(createPropertyAccess(createIdentifier("Object"), "hasOwn"), [
          rightRecord,
          key,
        ]),
        SyntaxKind.AmpersandAmpersandToken,
        createFunctionCall(createIdentifier(jsonEqualHelperName), [
          createElementAccess(leftRecord, key),
          createElementAccess(rightRecord, key),
        ]),
      ),
    ),
  ]);

  return createBinary(sameKeyCount, SyntaxKind.AmpersandAmpersandToken, sameProperties);
};

const createObjectKeys = (record: Expression): Expression =>
  createFunctionCall(createPropertyAccess(createIdentifier("Object"), "keys"), [record]);

const createJsonEqualHelper = (): VariableStatement => {
  const left = createIdentifier("left");
  const right = createIdentifier("right");
  const leftRecord = createIdentifier("leftRecord");
  const rightRecord = createIdentifier("rightRecord");
  const leftKeys = createIdentifier("leftKeys");
  const rightKeys = createIdentifier("rightKeys");
  const recordType = createTypeReferenceNode(createIdentifier("Record"), [
    createKeywordTypeNode(SyntaxKind.StringKeyword),
    createKeywordTypeNode(SyntaxKind.UnknownKeyword),
  ]);
  const helper = createArrowFunction(
    undefined,
    undefined,
    [
      createArrowParameter("left", createKeywordTypeNode(SyntaxKind.UnknownKeyword)),
      createArrowParameter("right", createKeywordTypeNode(SyntaxKind.UnknownKeyword)),
    ],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createBlock(
      [
        createIfStatement(
          createBinary(left, SyntaxKind.EqualsEqualsEqualsToken, right),
          createReturnStatement(createKeywordExpression(SyntaxKind.TrueKeyword)),
        ),
        createIfStatement(
          createObjectMismatch(left, right),
          createReturnStatement(createKeywordExpression(SyntaxKind.FalseKeyword)),
        ),
        createIfStatement(
          createBinary(createIsArray(left), SyntaxKind.BarBarToken, createIsArray(right)),
          createReturnStatement(createArrayEquality(left, right)),
        ),
        createConstStatement(leftRecord, createAsExpression(left, recordType)),
        createConstStatement(rightRecord, createAsExpression(right, recordType)),
        createConstStatement(leftKeys, createObjectKeys(leftRecord)),
        createConstStatement(rightKeys, createObjectKeys(rightRecord)),
        createReturnStatement(createObjectEquality(leftRecord, rightRecord)),
      ],
      true,
    ),
  );

  return createConstStatement(createIdentifier(jsonEqualHelperName), helper);
};

const createUniqueItemsHelper = (): VariableStatement => {
  const values = createIdentifier("values");
  const value = createIdentifier("value");
  const index = createIdentifier("index");
  const candidate = createIdentifier("candidate");
  const firstMatchIndex = createFunctionCall(createPropertyAccess(values, "findIndex"), [
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("candidate")],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createFunctionCall(createIdentifier(jsonEqualHelperName), [value, candidate]),
    ),
  ]);
  const isFirstMatch = createBinary(firstMatchIndex, SyntaxKind.EqualsEqualsEqualsToken, index);
  const helper = createArrowFunction(
    undefined,
    undefined,
    [
      createArrowParameter(
        "values",
        createTypeOperatorNode(
          SyntaxKind.ReadonlyKeyword,
          createArrayTypeNode(createKeywordTypeNode(SyntaxKind.UnknownKeyword)),
        ),
      ),
    ],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createFunctionCall(createPropertyAccess(values, "every"), [
      createArrowFunction(
        undefined,
        undefined,
        [createArrowParameter("value"), createArrowParameter("index")],
        undefined,
        createToken(SyntaxKind.EqualsGreaterThanToken),
        isFirstMatch,
      ),
    ]),
  );

  return createConstStatement(createIdentifier(uniqueItemsHelperName), helper);
};

export const createUniqueItemsHelperStatements = (): readonly VariableStatement[] => [
  createJsonEqualHelper(),
  createUniqueItemsHelper(),
];
