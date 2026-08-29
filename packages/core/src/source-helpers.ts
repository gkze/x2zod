import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  BinaryOperator,
  BindingElement,
  BindingName,
  Expression,
  ParameterDeclaration,
  Statement,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayBindingPattern,
  createArrayLiteralExpression,
  createArrayTypeNode,
  createArrowFunction,
  createBigIntLiteral,
  createBinaryExpression,
  createBindingElement,
  createBlock,
  createCallExpression,
  createConditionalExpression,
  createIdentifier,
  createKeywordExpression,
  createKeywordTypeNode,
  createLiteralTypeNode,
  createNumericLiteral,
  createParameterDeclaration,
  createPrefixUnaryExpression,
  createPropertyAccessExpression,
  createQualifiedName,
  createReturnStatement,
  createStringLiteral,
  createToken,
  createTypeOfExpression,
  createTupleTypeNode,
  createTypeOperatorNode,
  createTypeParameterDeclaration,
  createTypeReferenceNode,
  createUnionTypeNode,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

import type { ZodHelperName, ZodHelperRequest, ZodWrapperName } from "./zod-helpers";

const noTokenFlags = 0;
const decimalPartsHelperName = "x2zodDecimalParts";
const codePointLengthHelperName = "x2zodCodePointLength";
const exactMultipleOfHelperName = "x2zodExactMultipleOf";
const preserveObjectInputHelperName = "x2zodPreserveObjectInput";
const wrapperHelperNames: Readonly<Record<ZodWrapperName, string>> = {
  preserveObjectInput: preserveObjectInputHelperName,
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod helper request: ${JSON.stringify(value)}`);
};

const createArrowParameter = (name: string, type?: TypeNode): ParameterDeclaration =>
  createParameterDeclaration(undefined, undefined, createIdentifier(name), undefined, type);

const createPropertyAccess = (expression: Expression, name: string): Expression =>
  createPropertyAccessExpression(expression, undefined, createIdentifier(name), NodeFlags.None);

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

const createStringMethodCall = (
  expression: Expression,
  method: string,
  argument: string,
): Expression =>
  createFunctionCall(createPropertyAccess(expression, method), [
    createStringLiteral(argument, noTokenFlags),
  ]);

const createDefaultedBinding = (name: string, value: string): BindingElement =>
  createBindingElement(
    undefined,
    undefined,
    createIdentifier(name),
    createStringLiteral(value, noTokenFlags),
  );

const createDecimalPartsHelper = (): VariableStatement => {
  const value = createIdentifier("value");
  const coefficientText = createIdentifier("coefficientText");
  const exponentText = createIdentifier("exponentText");
  const whole = createIdentifier("whole");
  const fraction = createIdentifier("fraction");
  const decimalPartsType = createTypeOperatorNode(
    SyntaxKind.ReadonlyKeyword,
    createTupleTypeNode([
      createKeywordTypeNode(SyntaxKind.BigIntKeyword),
      createKeywordTypeNode(SyntaxKind.NumberKeyword),
    ]),
  );
  const helper = createArrowFunction(
    undefined,
    undefined,
    [createArrowParameter("value", createKeywordTypeNode(SyntaxKind.NumberKeyword))],
    decimalPartsType,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createBlock(
      [
        createConstStatement(
          createArrayBindingPattern([
            createDefaultedBinding("coefficientText", "0"),
            createDefaultedBinding("exponentText", "0"),
          ]),
          createStringMethodCall(
            createFunctionCall(createPropertyAccess(value, "toString"), []),
            "split",
            "e",
          ),
        ),
        createConstStatement(
          createArrayBindingPattern([
            createDefaultedBinding("whole", "0"),
            createDefaultedBinding("fraction", ""),
          ]),
          createStringMethodCall(coefficientText, "split", "."),
        ),
        createReturnStatement(
          createArrayLiteralExpression(
            [
              createFunctionCall(createIdentifier("BigInt"), [
                createBinary(whole, SyntaxKind.PlusToken, fraction),
              ]),
              createBinary(
                createPropertyAccess(fraction, "length"),
                SyntaxKind.MinusToken,
                createFunctionCall(createIdentifier("Number"), [exponentText]),
              ),
            ],
            false,
          ),
        ),
      ],
      true,
    ),
  );

  return createConstStatement(createIdentifier(decimalPartsHelperName), helper);
};

const createCodePointLengthHelper = (): VariableStatement => {
  const minimum = createIdentifier("minimum");
  const maximum = createIdentifier("maximum");
  const value = createIdentifier("value");
  const length = createIdentifier("length");
  const nullExpression = createKeywordExpression(SyntaxKind.NullKeyword);
  const nullableNumberType = createUnionTypeNode([
    createKeywordTypeNode(SyntaxKind.NumberKeyword),
    createLiteralTypeNode(createKeywordExpression(SyntaxKind.NullKeyword)),
  ]);
  const helper = createArrowFunction(
    undefined,
    undefined,
    [
      createArrowParameter("minimum", nullableNumberType),
      createArrowParameter("maximum", nullableNumberType),
    ],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("value", createKeywordTypeNode(SyntaxKind.StringKeyword))],
      createKeywordTypeNode(SyntaxKind.BooleanKeyword),
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createBlock(
        [
          createConstStatement(
            length,
            createPropertyAccess(
              createFunctionCall(createPropertyAccess(createIdentifier("Array"), "from"), [value]),
              "length",
            ),
          ),
          createReturnStatement(
            createBinary(
              createBinary(
                createBinary(minimum, SyntaxKind.EqualsEqualsEqualsToken, nullExpression),
                SyntaxKind.BarBarToken,
                createBinary(length, SyntaxKind.GreaterThanEqualsToken, minimum),
              ),
              SyntaxKind.AmpersandAmpersandToken,
              createBinary(
                createBinary(
                  maximum,
                  SyntaxKind.EqualsEqualsEqualsToken,
                  createKeywordExpression(SyntaxKind.NullKeyword),
                ),
                SyntaxKind.BarBarToken,
                createBinary(length, SyntaxKind.LessThanEqualsToken, maximum),
              ),
            ),
          ),
        ],
        true,
      ),
    ),
  );

  return createConstStatement(createIdentifier(codePointLengthHelperName), helper);
};

const createExactMultipleOfHelper = (): VariableStatement => {
  const valueCoefficient = createIdentifier("valueCoefficient");
  const valueScale = createIdentifier("valueScale");
  const divisorCoefficient = createIdentifier("divisorCoefficient");
  const divisorScale = createIdentifier("divisorScale");
  const scaleDelta = createIdentifier("scaleDelta");
  const divisor = createIdentifier("divisor");
  const value = createIdentifier("value");
  const zero = createBigIntLiteral("0n", noTokenFlags);
  const powerOfTen = (exponent: Expression): Expression =>
    createBinary(
      createBigIntLiteral("10n", noTokenFlags),
      SyntaxKind.AsteriskAsteriskToken,
      createFunctionCall(createIdentifier("BigInt"), [exponent]),
    );
  const helper = createArrowFunction(
    undefined,
    undefined,
    [createArrowParameter("divisor", createKeywordTypeNode(SyntaxKind.NumberKeyword))],
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    createArrowFunction(
      undefined,
      undefined,
      [createArrowParameter("value", createKeywordTypeNode(SyntaxKind.NumberKeyword))],
      createKeywordTypeNode(SyntaxKind.BooleanKeyword),
      createToken(SyntaxKind.EqualsGreaterThanToken),
      createBlock(
        [
          createConstStatement(
            createArrayBindingPattern([
              createBindingElement(undefined, undefined, valueCoefficient),
              createBindingElement(undefined, undefined, valueScale),
            ]),
            createFunctionCall(createIdentifier(decimalPartsHelperName), [value]),
          ),
          createConstStatement(
            createArrayBindingPattern([
              createBindingElement(undefined, undefined, divisorCoefficient),
              createBindingElement(undefined, undefined, divisorScale),
            ]),
            createFunctionCall(createIdentifier(decimalPartsHelperName), [divisor]),
          ),
          createConstStatement(
            scaleDelta,
            createBinary(divisorScale, SyntaxKind.MinusToken, valueScale),
          ),
          createReturnStatement(
            createConditionalExpression(
              createBinary(
                scaleDelta,
                SyntaxKind.GreaterThanEqualsToken,
                createNumericLiteral("0", noTokenFlags),
              ),
              createToken(SyntaxKind.QuestionToken),
              createBinary(
                createBinary(
                  createBinary(valueCoefficient, SyntaxKind.AsteriskToken, powerOfTen(scaleDelta)),
                  SyntaxKind.PercentToken,
                  divisorCoefficient,
                ),
                SyntaxKind.EqualsEqualsEqualsToken,
                zero,
              ),
              createToken(SyntaxKind.ColonToken),
              createBinary(
                createBinary(
                  valueCoefficient,
                  SyntaxKind.PercentToken,
                  createBinary(
                    divisorCoefficient,
                    SyntaxKind.AsteriskToken,
                    powerOfTen(createPrefixUnaryExpression(SyntaxKind.MinusToken, scaleDelta)),
                  ),
                ),
                SyntaxKind.EqualsEqualsEqualsToken,
                createBigIntLiteral("0n", noTokenFlags),
              ),
            ),
          ),
        ],
        true,
      ),
    ),
  );

  return createConstStatement(createIdentifier(exactMultipleOfHelperName), helper);
};

const createPreserveObjectInputHelper = (): VariableStatement => {
  const schemaType = createIdentifier("TSchema");
  const schema = createIdentifier("schema");
  const keys = createIdentifier("requiredOwnKeys");
  const value = createIdentifier("value");
  const key = createIdentifier("key");
  const schemaInputType = createTypeReferenceNode(
    createQualifiedName(createIdentifier("z"), createIdentifier("input")),
    [createTypeReferenceNode(schemaType)],
  );
  const parsesWithSchema = createPropertyAccess(
    createFunctionCall(createPropertyAccess(schema, "safeParse"), [value]),
    "success",
  );
  const valueCanHaveOwnKeys = createBinary(
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
    undefined,
    createToken(SyntaxKind.EqualsGreaterThanToken),
    customSchema,
  );

  return createConstStatement(createIdentifier(preserveObjectInputHelperName), helper);
};

export const createZodHelperExpression = (request: ZodHelperRequest): Expression => {
  switch (request.helper) {
    case "codePointLength": {
      const boundExpression = (value: number | null): Expression =>
        value === null
          ? createKeywordExpression(SyntaxKind.NullKeyword)
          : createNumericLiteral(String(value), noTokenFlags);
      return createFunctionCall(createIdentifier(codePointLengthHelperName), [
        boundExpression(request.minimum),
        boundExpression(request.maximum),
      ]);
    }
    case "exactMultipleOf": {
      return createFunctionCall(createIdentifier(exactMultipleOfHelperName), [
        createNumericLiteral(String(request.divisor), noTokenFlags),
      ]);
    }
    default: {
      return assertNever(request);
    }
  }
};

export const createZodWrapperExpression = (
  wrapper: ZodWrapperName,
  schema: Expression,
  requiredOwnKeys: readonly string[],
): Expression =>
  createFunctionCall(createIdentifier(wrapperHelperNames[wrapper]), [
    schema,
    createArrayLiteralExpression(
      requiredOwnKeys.map((key) => createStringLiteral(key, noTokenFlags)),
      false,
    ),
  ]);

export const createZodHelperStatements = (
  helperNames: ReadonlySet<ZodHelperName>,
): readonly Statement[] => {
  const statements: Statement[] = [];
  if (helperNames.has("codePointLength")) statements.push(createCodePointLengthHelper());
  if (helperNames.has("exactMultipleOf"))
    statements.push(createDecimalPartsHelper(), createExactMultipleOfHelper());
  if (helperNames.has("preserveObjectInput")) statements.push(createPreserveObjectInputHelper());
  return statements;
};
