import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type { Expression, TypeNode } from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createCallExpression,
  createIdentifier,
  createPropertyAccessExpression,
  createQualifiedName,
  createToken,
  createTypeReferenceNode,
} from "@typescript/native-preview/unstable/ast/factory";

export const createLazyReferenceExpression = (
  reference: Expression,
  returnType?: TypeNode,
): Expression =>
  createCallExpression(
    createPropertyAccessExpression(
      createIdentifier("z"),
      undefined,
      createIdentifier("lazy"),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    [
      createArrowFunction(
        undefined,
        undefined,
        [],
        returnType ??
          createTypeReferenceNode(
            createQualifiedName(createIdentifier("z"), createIdentifier("ZodTypeAny")),
          ),
        createToken(SyntaxKind.EqualsGreaterThanToken),
        reference,
      ),
    ],
    NodeFlags.None,
  );
