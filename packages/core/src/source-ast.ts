import { NodeFlags } from "@typescript/native-preview/unstable/ast";
import type {
  BinaryOperator,
  BindingName,
  Expression,
  ParameterDeclaration,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createBinaryExpression,
  createCallExpression,
  createElementAccessExpression,
  createIdentifier,
  createParameterDeclaration,
  createPropertyAccessExpression,
  createQualifiedName,
  createToken,
  createTypeReferenceNode,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

export const createSourceArrowParameter = (name: string, type?: TypeNode): ParameterDeclaration =>
  createParameterDeclaration(undefined, undefined, createIdentifier(name), undefined, type);

export const createSourceBinary = (
  left: Expression,
  operator: BinaryOperator,
  right: Expression,
): Expression => createBinaryExpression(undefined, left, undefined, createToken(operator), right);

export const createSourceConstStatement = (
  name: BindingName | string,
  initializer: Expression,
  type?: TypeNode,
): VariableStatement =>
  createVariableStatement(
    undefined,
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          typeof name === "string" ? createIdentifier(name) : name,
          undefined,
          type,
          initializer,
        ),
      ],
      NodeFlags.Const,
    ),
  );

export const createSourceElementAccess = (expression: Expression, key: Expression): Expression =>
  createElementAccessExpression(expression, undefined, key, NodeFlags.None);

export const createSourceFunctionCall = (
  expression: Expression,
  args: readonly Expression[],
): Expression => createCallExpression(expression, undefined, undefined, args, NodeFlags.None);

export const createSourcePropertyAccess = (expression: Expression, name: string): Expression =>
  createPropertyAccessExpression(expression, undefined, createIdentifier(name), NodeFlags.None);

export const createSourceZodType = (
  name: string,
  typeArguments: readonly TypeNode[] = [],
): TypeNode =>
  createTypeReferenceNode(createQualifiedName(createIdentifier("z"), createIdentifier(name)), [
    ...typeArguments,
  ]);
