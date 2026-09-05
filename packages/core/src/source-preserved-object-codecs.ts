import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  Statement,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayTypeNode,
  createArrowFunction,
  createAsExpression,
  createBlock,
  createCallExpression,
  createConditionalExpression,
  createExpressionStatement,
  createIdentifier,
  createIfStatement,
  createKeywordExpression,
  createKeywordTypeNode,
  createLiteralTypeNode,
  createObjectLiteralExpression,
  createPrefixUnaryExpression,
  createQualifiedName,
  createReturnStatement,
  createSpreadAssignment,
  createStringLiteral,
  createToken,
  createTypeOfExpression,
  createTypeOperatorNode,
  createTypeParameterDeclaration,
  createTypeReferenceNode,
  createUnionTypeNode,
} from "@typescript/native-preview/unstable/ast/factory";

import {
  createSourceArrowParameter as parameter,
  createSourceBinary as binary,
  createSourceConstStatement as constant,
  createSourceElementAccess as element,
  createSourceFunctionCall as call,
  createSourcePropertyAccess as property,
  createSourceZodType as zodType,
} from "./source-ast";
import { createPropertyAssignment as assignment } from "./source-codecs";

export const preservedObjectCodecHelperName = "x2zodPreserveObjectCodec";
const text = (value: string): Expression => createStringLiteral(value, 0);
const identifier = createIdentifier;
const truth = (): Expression => createKeywordExpression(SyntaxKind.TrueKeyword);
const own = (value: Expression, key: Expression): Expression =>
  call(property(identifier("Object"), "hasOwn"), [value, key]);
const and = (left: Expression, right: Expression): Expression =>
  binary(left, SyntaxKind.AmpersandAmpersandToken, right);
const arrow = (parameters: readonly string[], body: Expression): Expression =>
  createArrowFunction(
    undefined,
    undefined,
    parameters.map((name) => parameter(name)),
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    body,
  );
const recordType = (): TypeNode =>
  createTypeReferenceNode(createQualifiedName(identifier("globalThis"), identifier("Record")), [
    createKeywordTypeNode(SyntaxKind.StringKeyword),
    createKeywordTypeNode(SyntaxKind.UnknownKeyword),
  ]);

const parseFailure = (name: string): Statement =>
  createIfStatement(
    createPrefixUnaryExpression(SyntaxKind.ExclamationToken, property(identifier(name), "success")),
    createBlock(
      [
        createExpressionStatement(
          call(property(property(identifier("payload"), "issues"), "push"), [
            createObjectLiteralExpression(
              [
                assignment(identifier("code"), text("custom")),
                assignment(identifier("input"), identifier("value")),
                assignment(
                  identifier("message"),
                  property(property(identifier(name), "error"), "message"),
                ),
              ],
              false,
            ),
          ]),
        ),
        createReturnStatement(property(identifier("z"), "NEVER")),
      ],
      true,
    ),
  );

const directionalParse = (decode: Expression, encode: Expression): Expression =>
  createConditionalExpression(
    binary(identifier("direction"), SyntaxKind.EqualsEqualsEqualsToken, text("decode")),
    createToken(SyntaxKind.QuestionToken),
    decode,
    createToken(SyntaxKind.ColonToken),
    encode,
  );

// Zod omits this own key from object parse output; project its value explicitly.
const prototypeProjection = (): Statement => {
  const schema = identifier("prototypeSchema");
  const value = element(identifier("value"), text("__proto__"));
  return createIfStatement(
    and(
      own(identifier("value"), text("__proto__")),
      binary(schema, SyntaxKind.ExclamationEqualsEqualsToken, identifier("undefined")),
    ),
    createBlock(
      [
        constant(
          "prototypeResult",
          directionalParse(
            call(property(identifier("z"), "safeDecode"), [schema, value]),
            call(property(identifier("z"), "safeEncode"), [schema, value]),
          ),
        ),
        parseFailure("prototypeResult"),
        createExpressionStatement(
          call(property(identifier("Object"), "defineProperty"), [
            identifier("result"),
            text("__proto__"),
            createObjectLiteralExpression(
              [
                assignment(identifier("value"), property(identifier("prototypeResult"), "data")),
                assignment(identifier("enumerable"), truth()),
                assignment(identifier("configurable"), truth()),
                assignment(identifier("writable"), truth()),
              ],
              false,
            ),
          ]),
        ),
      ],
      true,
    ),
  );
};

const transformFunction = (): Expression => {
  const ownValue = call(property(identifier("Object"), "assign"), [
    call(property(identifier("Object"), "create"), [
      createKeywordExpression(SyntaxKind.NullKeyword),
    ]),
    identifier("value"),
  ]);
  return createArrowFunction(
    undefined,
    undefined,
    [
      parameter("value", recordType()),
      parameter(
        "payload",
        createTypeReferenceNode(
          createQualifiedName(
            createQualifiedName(identifier("z"), identifier("core")),
            identifier("ParsePayload"),
          ),
        ),
      ),
      parameter(
        "direction",
        createUnionTypeNode([
          createLiteralTypeNode(text("decode")),
          createLiteralTypeNode(text("encode")),
        ]),
      ),
    ],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createBlock(
      [
        constant("ownValue", ownValue),
        constant(
          "parsed",
          directionalParse(
            call(property(identifier("schema"), "safeDecode"), [identifier("ownValue")]),
            call(property(identifier("schema"), "safeEncode"), [identifier("ownValue")]),
          ),
        ),
        parseFailure("parsed"),
        constant(
          "result",
          createObjectLiteralExpression(
            [
              createSpreadAssignment(identifier("value")),
              createSpreadAssignment(property(identifier("parsed"), "data")),
            ],
            false,
          ),
        ),
        constant(
          "prototypeSchema",
          createConditionalExpression(
            own(property(identifier("schema"), "shape"), text("__proto__")),
            createToken(SyntaxKind.QuestionToken),
            element(property(identifier("schema"), "shape"), text("__proto__")),
            createToken(SyntaxKind.ColonToken),
            property(property(identifier("schema"), "def"), "catchall"),
          ),
        ),
        prototypeProjection(),
        createReturnStatement(identifier("result")),
      ],
      true,
    ),
  );
};

export const createPreservedObjectCodecHelper = (): VariableStatement => {
  const schemaType = createTypeReferenceNode(identifier("TSchema"));
  const value = identifier("value");
  const ownKeys = createArrowFunction(
    undefined,
    undefined,
    [parameter("value", createKeywordTypeNode(SyntaxKind.UnknownKeyword))],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    and(
      and(
        and(
          binary(createTypeOfExpression(value), SyntaxKind.EqualsEqualsEqualsToken, text("object")),
          binary(
            value,
            SyntaxKind.ExclamationEqualsEqualsToken,
            createKeywordExpression(SyntaxKind.NullKeyword),
          ),
        ),
        createPrefixUnaryExpression(
          SyntaxKind.ExclamationToken,
          call(property(identifier("Array"), "isArray"), [value]),
        ),
      ),
      call(property(identifier("requiredOwnKeys"), "every"), [
        arrow(["key"], own(value, identifier("key"))),
      ]),
    ),
  );
  const custom = (projection: "input" | "output"): Expression =>
    createCallExpression(
      property(identifier("z"), "custom"),
      undefined,
      [zodType(projection, [schemaType])],
      [identifier("hasOwnKeys")],
      NodeFlags.None,
    );
  const codecOperation = (direction: "decode" | "encode"): Expression =>
    arrow(
      ["value", "payload"],
      createAsExpression(
        call(identifier("transform"), [value, identifier("payload"), text(direction)]),
        zodType(direction === "decode" ? "output" : "input", [schemaType]),
      ),
    );
  return constant(
    preservedObjectCodecHelperName,
    createArrowFunction(
      undefined,
      [createTypeParameterDeclaration(undefined, identifier("TSchema"), zodType("ZodObject"))],
      [
        parameter("schema", schemaType),
        parameter(
          "requiredOwnKeys",
          createTypeOperatorNode(
            SyntaxKind.ReadonlyKeyword,
            createArrayTypeNode(createKeywordTypeNode(SyntaxKind.StringKeyword)),
          ),
        ),
      ],
      undefined,
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createBlock(
        [
          constant("transform", transformFunction()),
          constant("hasOwnKeys", ownKeys),
          createReturnStatement(
            call(property(identifier("z"), "codec"), [
              custom("input"),
              custom("output"),
              createObjectLiteralExpression(
                [
                  assignment(identifier("decode"), codecOperation("decode")),
                  assignment(identifier("encode"), codecOperation("encode")),
                ],
                false,
              ),
            ]),
          ),
        ],
        true,
      ),
    ),
  );
};
