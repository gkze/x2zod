import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  PropertyAssignment,
  PropertyName,
  Statement,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayBindingPattern,
  createArrayLiteralExpression,
  createArrowFunction,
  createArrayTypeNode,
  createAsExpression,
  createBindingElement,
  createBlock,
  createContinueStatement,
  createDeleteExpression,
  createExpressionStatement,
  createForOfStatement,
  createIdentifier,
  createIfStatement,
  createKeywordExpression,
  createKeywordTypeNode,
  createObjectLiteralExpression,
  createPrefixUnaryExpression,
  createPropertyAssignment as createNativePropertyAssignment,
  createQualifiedName,
  createReturnStatement,
  createSpreadAssignment,
  createStringLiteral,
  createToken,
  createTupleTypeNode,
  createTypeOperatorNode,
  createTypeParameterDeclaration,
  createTypeReferenceNode,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

import {
  createSourceArrowParameter as createArrowParameter,
  createSourceElementAccess as createElementAccess,
  createSourceFunctionCall as createFunctionCall,
  createSourcePropertyAccess as createPropertyAccess,
} from "./source-ast";
import type {
  SourceCodecExpression,
  SourceCodecOperation,
  SourceExpression,
  SourcePropertyKeyMapping,
} from "./source-model";

const noTokenFlags = 0;
export const remapPropertiesHelperName = "x2zodRemapProperties";

type CreateSourceCodecExpressionInput = Readonly<{
  createExpression: (expression: SourceExpression) => Expression;
  expression: SourceCodecExpression;
}>;

// Native preview currently types property-assignment annotations as required.
// The implementation accepts undefined for ordinary object properties.
const omittedNativePropertyType = undefined as never;

export const createPropertyAssignment = (
  name: PropertyName,
  initializer: Expression,
  type?: TypeNode,
): PropertyAssignment =>
  createNativePropertyAssignment(
    undefined,
    name,
    undefined,
    type ?? omittedNativePropertyType,
    initializer,
  );

const createKeyMappingExpression = (
  mapping: SourcePropertyKeyMapping,
  direction: "decode" | "encode",
): Expression =>
  createArrayLiteralExpression(
    direction === "decode"
      ? [
          createStringLiteral(mapping.encodedKey, noTokenFlags),
          createStringLiteral(mapping.decodedKey, noTokenFlags),
        ]
      : [
          createStringLiteral(mapping.decodedKey, noTokenFlags),
          createStringLiteral(mapping.encodedKey, noTokenFlags),
        ],
    false,
  );

const createCodecCallback = (
  operation: SourceCodecOperation,
  direction: "decode" | "encode",
): Expression => {
  const value = createIdentifier("value");
  if (operation.kind === "identity")
    return createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("value")],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      value,
    );

  return createArrowFunction(
    undefined,
    undefined,
    [createArrowParameter("value"), createArrowParameter("payload")],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createFunctionCall(createIdentifier(remapPropertiesHelperName), [
      value,
      createArrayLiteralExpression(
        operation.mappings.map((mapping) => createKeyMappingExpression(mapping, direction)),
        false,
      ),
      createIdentifier("payload"),
    ]),
  );
};

const createCodecCallbacks = (operation: SourceCodecOperation): Expression =>
  createObjectLiteralExpression(
    [
      createPropertyAssignment(
        createIdentifier("decode"),
        createCodecCallback(operation, "decode"),
      ),
      createPropertyAssignment(
        createIdentifier("encode"),
        createCodecCallback(operation, "encode"),
      ),
    ],
    true,
  );

export const createSourceCodecExpression = ({
  createExpression,
  expression,
}: CreateSourceCodecExpressionInput): Expression =>
  createFunctionCall(createPropertyAccess(createIdentifier("z"), "codec"), [
    createExpression(expression.input),
    createExpression(expression.output),
    createCodecCallbacks(expression.operation),
  ]);

const createRecordType = (): TypeNode =>
  createTypeReferenceNode(
    createQualifiedName(createIdentifier("globalThis"), createIdentifier("Record")),
    [
      createKeywordTypeNode(SyntaxKind.StringKeyword),
      createKeywordTypeNode(SyntaxKind.UnknownKeyword),
    ],
  );

const createMappingsType = (): TypeNode =>
  createTypeOperatorNode(
    SyntaxKind.ReadonlyKeyword,
    createArrayTypeNode(
      createTypeOperatorNode(
        SyntaxKind.ReadonlyKeyword,
        createTupleTypeNode([
          createKeywordTypeNode(SyntaxKind.StringKeyword),
          createKeywordTypeNode(SyntaxKind.StringKeyword),
        ]),
      ),
    ),
  );

const createParsePayloadType = (): TypeNode =>
  createTypeReferenceNode(
    createQualifiedName(
      createQualifiedName(createIdentifier("z"), createIdentifier("core")),
      createIdentifier("ParsePayload"),
    ),
  );

const createHasOwnCall = (object: Expression, key: Expression): Expression =>
  createFunctionCall(createPropertyAccess(createIdentifier("Object"), "hasOwn"), [object, key]);

const createRemapCollisionBlock = (): Statement => {
  const value = createIdentifier("value");
  const targetKey = createIdentifier("targetKey");
  const payload = createIdentifier("payload");
  const issue = createObjectLiteralExpression(
    [
      createPropertyAssignment(
        createIdentifier("code"),
        createStringLiteral("custom", noTokenFlags),
      ),
      createPropertyAssignment(createIdentifier("input"), value),
      createPropertyAssignment(
        createIdentifier("message"),
        createStringLiteral(
          "Property-key transform would overwrite an existing key.",
          noTokenFlags,
        ),
      ),
      createPropertyAssignment(
        createIdentifier("path"),
        createArrayLiteralExpression([targetKey], false),
      ),
    ],
    true,
  );

  return createIfStatement(
    createHasOwnCall(value, targetKey),
    createBlock(
      [
        createExpressionStatement(
          createFunctionCall(
            createPropertyAccess(createPropertyAccess(payload, "issues"), "push"),
            [issue],
          ),
        ),
        createReturnStatement(createPropertyAccess(createIdentifier("z"), "NEVER")),
      ],
      true,
    ),
  );
};

const createDefineMappedPropertyStatement = (): Statement => {
  const result = createIdentifier("result");
  const targetKey = createIdentifier("targetKey");
  const sourceKey = createIdentifier("sourceKey");
  const value = createIdentifier("value");
  return createExpressionStatement(
    createFunctionCall(createPropertyAccess(createIdentifier("Object"), "defineProperty"), [
      result,
      targetKey,
      createObjectLiteralExpression(
        [
          createPropertyAssignment(
            createIdentifier("configurable"),
            createKeywordExpression(SyntaxKind.TrueKeyword),
          ),
          createPropertyAssignment(
            createIdentifier("enumerable"),
            createKeywordExpression(SyntaxKind.TrueKeyword),
          ),
          createPropertyAssignment(
            createIdentifier("value"),
            createElementAccess(value, sourceKey),
          ),
          createPropertyAssignment(
            createIdentifier("writable"),
            createKeywordExpression(SyntaxKind.TrueKeyword),
          ),
        ],
        true,
      ),
    ]),
  );
};

export const createRemapPropertiesHelper = (): VariableStatement => {
  const value = createIdentifier("value");
  const result = createIdentifier("result");
  const sourceKey = createIdentifier("sourceKey");
  const targetKey = createIdentifier("targetKey");
  const mappings = createIdentifier("mappings");
  const outputType = createIdentifier("TOutput");
  const loop = createForOfStatement(
    undefined,
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          createArrayBindingPattern([
            createBindingElement(undefined, undefined, sourceKey),
            createBindingElement(undefined, undefined, targetKey),
          ]),
        ),
      ],
      NodeFlags.Const,
    ),
    mappings,
    createBlock(
      [
        createIfStatement(
          createPrefixUnaryExpression(
            SyntaxKind.ExclamationToken,
            createHasOwnCall(value, sourceKey),
          ),
          createContinueStatement(),
        ),
        createRemapCollisionBlock(),
        createExpressionStatement(createDeleteExpression(createElementAccess(result, sourceKey))),
        createDefineMappedPropertyStatement(),
      ],
      true,
    ),
  );
  const helper = createArrowFunction(
    undefined,
    [createTypeParameterDeclaration(undefined, outputType)],
    [
      createArrowParameter("value", createRecordType()),
      createArrowParameter("mappings", createMappingsType()),
      createArrowParameter("payload", createParsePayloadType()),
    ],
    createTypeReferenceNode(outputType),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createBlock(
      [
        createVariableStatement(
          undefined,
          createVariableDeclarationList(
            [
              createVariableDeclaration(
                result,
                undefined,
                undefined,
                createObjectLiteralExpression([createSpreadAssignment(value)], false),
              ),
            ],
            NodeFlags.Const,
          ),
        ),
        loop,
        createReturnStatement(createAsExpression(result, createTypeReferenceNode(outputType))),
      ],
      true,
    ),
  );

  return createVariableStatement(
    undefined,
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          createIdentifier(remapPropertiesHelperName),
          undefined,
          undefined,
          helper,
        ),
      ],
      NodeFlags.Const,
    ),
  );
};
