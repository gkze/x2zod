import { SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  BindingElement,
  Expression,
  Statement,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayBindingPattern,
  createArrayLiteralExpression,
  createArrowFunction,
  createBigIntLiteral,
  createBindingElement,
  createBlock,
  createConditionalExpression,
  createIdentifier,
  createKeywordExpression,
  createKeywordTypeNode,
  createLiteralTypeNode,
  createNumericLiteral,
  createPrefixUnaryExpression,
  createReturnStatement,
  createStringLiteral,
  createToken,
  createTupleTypeNode,
  createTypeOperatorNode,
  createUnionTypeNode,
} from "@typescript/native-preview/unstable/ast/factory";

import {
  createSourceArrowParameter as createArrowParameter,
  createSourceBinary as createBinary,
  createSourceConstStatement as createConstStatement,
  createSourceFunctionCall as createFunctionCall,
  createSourcePropertyAccess as createPropertyAccess,
} from "./source-ast";
import type { SourceWrapperExpression } from "./source-model";
import { preservedObjectCodecHelperName } from "./source-preserved-object-codecs";
import {
  createPreserveObjectInputStatements,
  preservedInputTypeName,
  preserveObjectInputHelperName,
} from "./source-preserved-object-input";
import {
  createUniqueItemsHelperStatements,
  jsonEqualHelperName,
  uniqueItemsHelperName,
} from "./source-unique-items";
import type { ZodHelperName, ZodHelperRequest, ZodWrapperName } from "./zod-helpers";

export { createPreservedObjectCodecStatements } from "./source-preserved-object-codecs";

const noTokenFlags = 0;
const decimalPartsHelperName = "x2zodDecimalParts";
const codePointLengthHelperName = "x2zodCodePointLength";
const exactMultipleOfHelperName = "x2zodExactMultipleOf";
const wrapperHelperNames: Readonly<Record<ZodWrapperName, string>> = {
  preserveObjectInput: preserveObjectInputHelperName,
};
const helperIdentifiers: Readonly<
  Record<ZodHelperName, Readonly<{ entrypoint: string; dependencies: readonly string[] }>>
> = {
  codePointLength: { entrypoint: codePointLengthHelperName, dependencies: [] },
  exactMultipleOf: {
    entrypoint: exactMultipleOfHelperName,
    dependencies: [decimalPartsHelperName],
  },
  preserveObjectInput: {
    entrypoint: preserveObjectInputHelperName,
    dependencies: [preservedInputTypeName],
  },
  uniqueItems: { entrypoint: uniqueItemsHelperName, dependencies: [jsonEqualHelperName] },
};

export const zodHelperDependencyIdentifierNames: ReadonlySet<string> = new Set(
  Object.values(helperIdentifiers).flatMap((helper) => helper.dependencies),
);

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod helper request: ${JSON.stringify(value)}`);
};

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
    case "uniqueItems": {
      return createIdentifier(uniqueItemsHelperName);
    }
    default: {
      return assertNever(request);
    }
  }
};

export const createZodWrapperExpression = (
  expression: SourceWrapperExpression,
  schema: Expression,
): Expression =>
  createFunctionCall(
    createIdentifier(
      expression.parseStructural
        ? preservedObjectCodecHelperName
        : wrapperHelperNames[expression.wrapper],
    ),
    [
      schema,
      createArrayLiteralExpression(
        expression.requiredOwnKeys.map((key) => createStringLiteral(key, noTokenFlags)),
        false,
      ),
    ],
  );

export const createZodHelperStatements = (
  helperNames: ReadonlySet<ZodHelperName>,
): readonly Statement[] => {
  const statements: Statement[] = [];
  if (helperNames.has("codePointLength")) statements.push(createCodePointLengthHelper());
  if (helperNames.has("exactMultipleOf"))
    statements.push(createDecimalPartsHelper(), createExactMultipleOfHelper());
  if (helperNames.has("uniqueItems")) statements.push(...createUniqueItemsHelperStatements());
  if (helperNames.has("preserveObjectInput"))
    statements.push(...createPreserveObjectInputStatements());
  return statements;
};

export const zodHelperIdentifierNames = (
  helperNames: ReadonlySet<ZodHelperName>,
): readonly string[] => {
  const names: string[] = [];
  for (const helperName of helperNames) {
    const helper = helperIdentifiers[helperName];
    names.push(...helper.dependencies, helper.entrypoint);
  }
  return names;
};
