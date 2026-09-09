import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type { Statement, VariableStatement } from "@typescript/native-preview/unstable/ast";
import {
  createArrayTypeNode,
  createArrowFunction,
  createCallExpression,
  createIdentifier,
  createKeywordExpression,
  createKeywordTypeNode,
  createPrefixUnaryExpression,
  createQualifiedName,
  createStringLiteral,
  createToken,
  createTypeAliasDeclaration,
  createTypeOfExpression,
  createTypeOperatorNode,
  createTypeParameterDeclaration,
  createTypeReferenceNode,
} from "@typescript/native-preview/unstable/ast/factory";

import {
  createSourceArrowParameter as createArrowParameter,
  createSourceBinary as createBinary,
  createSourceConstStatement as createConstStatement,
  createSourceFunctionCall as createFunctionCall,
  createSourcePropertyAccess as createPropertyAccess,
  createSourceZodType as zodType,
} from "./source-ast";

const noTokenFlags = 0;
export const preservedInputTypeName = "X2zodPreservedInput";
export const preserveObjectInputHelperName = "x2zodPreserveObjectInput";

const createPreserveObjectInputHelper = (): VariableStatement => {
  const schemaType = createIdentifier("TSchema");
  const schema = createIdentifier("schema");
  const keys = createIdentifier("requiredOwnKeys");
  const value = createIdentifier("value");
  const key = createIdentifier("key");
  const ownValue = createFunctionCall(createPropertyAccess(createIdentifier("Object"), "assign"), [
    createFunctionCall(createPropertyAccess(createIdentifier("Object"), "create"), [
      createKeywordExpression(SyntaxKind.NullKeyword),
    ]),
    value,
  ]);
  const schemaInputType = createTypeReferenceNode(
    createQualifiedName(createIdentifier("z"), createIdentifier("input")),
    [createTypeReferenceNode(schemaType)],
  );
  const parsesWithSchema = createPropertyAccess(
    createFunctionCall(createPropertyAccess(schema, "safeParse"), [ownValue]),
    "success",
  );
  const valueCanHaveOwnKeys = createBinary(
    createBinary(
      createBinary(
        createTypeOfExpression(value),
        SyntaxKind.EqualsEqualsEqualsToken,
        createStringLiteral("object", noTokenFlags),
      ),
      SyntaxKind.AmpersandAmpersandToken,
      createBinary(
        value,
        SyntaxKind.ExclamationEqualsEqualsToken,
        createKeywordExpression(SyntaxKind.NullKeyword),
      ),
    ),
    SyntaxKind.AmpersandAmpersandToken,
    createPrefixUnaryExpression(
      SyntaxKind.ExclamationToken,
      createFunctionCall(createPropertyAccess(createIdentifier("Array"), "isArray"), [value]),
    ),
  );
  const hasEveryRequiredOwnKey = createFunctionCall(createPropertyAccess(keys, "every"), [
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("key")],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createFunctionCall(createPropertyAccess(createIdentifier("Object"), "hasOwn"), [value, key]),
    ),
  ]);
  const predicate = createArrowFunction(
    undefined,
    undefined,
    [createArrowParameter("value")],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createBinary(
      createBinary(valueCanHaveOwnKeys, SyntaxKind.AmpersandAmpersandToken, hasEveryRequiredOwnKey),
      SyntaxKind.AmpersandAmpersandToken,
      parsesWithSchema,
    ),
  );
  const customSchema = createCallExpression(
    createPropertyAccess(createIdentifier("z"), "custom"),
    undefined,
    [schemaInputType],
    [predicate],
    NodeFlags.None,
  );
  const helper = createArrowFunction(
    undefined,
    [
      createTypeParameterDeclaration(
        undefined,
        schemaType,
        createTypeReferenceNode(
          createQualifiedName(createIdentifier("z"), createIdentifier("ZodType")),
        ),
      ),
    ],
    [
      createArrowParameter("schema", createTypeReferenceNode(schemaType)),
      createArrowParameter(
        "requiredOwnKeys",
        createTypeOperatorNode(
          SyntaxKind.ReadonlyKeyword,
          createArrayTypeNode(createKeywordTypeNode(SyntaxKind.StringKeyword)),
        ),
      ),
    ],
    createTypeReferenceNode(createIdentifier(preservedInputTypeName), [
      createTypeReferenceNode(schemaType),
    ]),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    customSchema,
  );

  return createConstStatement(createIdentifier(preserveObjectInputHelperName), helper);
};

export const createPreserveObjectInputStatements = (): readonly Statement[] => {
  const schemaType = createTypeReferenceNode(createIdentifier("TSchema"));
  const inputType = zodType("input", [schemaType]);
  // Keep Zod projections named: declaration serialization can flatten a valid intersection
  // Into an invalid object literal when optional prototype keys meet a typed catchall.
  return [
    createTypeAliasDeclaration(
      undefined,
      createIdentifier(preservedInputTypeName),
      [createTypeParameterDeclaration(undefined, createIdentifier("TSchema"), zodType("ZodType"))],
      zodType("ZodCustom", [inputType, inputType]),
    ),
    createPreserveObjectInputHelper(),
  ];
};
