import {
  isArrowFunction,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionLikeDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isInterfaceDeclaration,
  isMetaProperty,
  isModuleDeclaration,
  isNewExpression,
  isPropertyAccessExpression,
  isThisExpression,
  isThisTypeNode,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  SyntaxKind,
} from "@typescript/native-preview/ast";
import type {
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Node,
  ParameterDeclaration,
  SourceFile,
  TypeNode,
  TypeParameterDeclaration,
  VariableDeclaration,
} from "@typescript/native-preview/ast";
import {
  getLeadingCommentRanges,
  getTrailingCommentRanges,
} from "@typescript/native-preview/ast/scanner";

import { isOptionsRecord } from "#options";
import { createSourceRule } from "#rule";
import type { Rule, RuleContext } from "#rule";
import { collectNodes, containsCommentMarker, getNodeStart, isSameNode, textForNode } from "#text";
import type { TextReplacement } from "#text";

interface ConstArrowFunctionsOptions {
  includeExportedFunctions?: boolean;
}

interface NodeWithModifiers extends Node {
  readonly modifiers?: readonly Node[];
}

type FunctionToConvert = FunctionDeclaration | FunctionExpression;

const emptyText = "";
const missingIndex = -1;
const singleTypeParameterLength = 1;
const constArrowDescription = [
  "convert safe function declarations and const function expressions to const",
  "arrows",
].join(" ");
const constArrowMessage = ["Convert function to const", "arrow."].join(" ");

const hasModifierList = (node: Node): node is NodeWithModifiers => "modifiers" in node;

const hasModifier = (node: Node, kind: SyntaxKind): boolean => {
  const modifiers = hasModifierList(node) ? node.modifiers : undefined;

  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
};

const getTextList = (
  sourceFile: SourceFile,
  nodes: readonly Node[] | undefined,
): string | undefined => {
  const firstNode = nodes?.[0];
  const lastNode = nodes?.at(-singleTypeParameterLength);

  if (firstNode === undefined || lastNode === undefined) return emptyText;

  const text = sourceFile.text.slice(getNodeStart(sourceFile, firstNode), lastNode.end);

  return containsCommentMarker(text) ? undefined : text;
};

const getTypeParametersText = (
  sourceFile: SourceFile,
  typeParameters: readonly TypeParameterDeclaration[] | undefined,
): string | undefined => {
  const text = getTextList(sourceFile, typeParameters);

  if (text === undefined) return undefined;
  if (text.length === 0) return emptyText;

  const trailingComma = typeParameters?.length === singleTypeParameterLength ? "," : emptyText;

  return `<${text}${trailingComma}>`;
};

const hasThisParameter = (parameters: readonly ParameterDeclaration[]): boolean =>
  parameters.some((parameter) => textForNode(parameter.getSourceFile(), parameter.name) === "this");

const getParametersText = (
  sourceFile: SourceFile,
  parameters: readonly ParameterDeclaration[],
): string | undefined => {
  if (hasThisParameter(parameters)) return undefined;

  const text = getTextList(sourceFile, parameters);

  return text === undefined ? undefined : `(${text})`;
};

const getReturnTypeText = (
  sourceFile: SourceFile,
  returnTypeNode: TypeNode | undefined,
): string | undefined => {
  if (returnTypeNode === undefined) return emptyText;

  const text = textForNode(sourceFile, returnTypeNode);

  return containsCommentMarker(text) ? undefined : `: ${text}`;
};

const hasCommentBetweenSignatureAndBody = (
  sourceFile: SourceFile,
  functionNode: FunctionToConvert,
): boolean => {
  const { body } = functionNode;

  if (body === undefined) return true;

  const signatureText = sourceFile.text.slice(
    getNodeStart(sourceFile, functionNode),
    getNodeStart(sourceFile, body),
  );
  const closeParenIndex = signatureText.lastIndexOf(")");

  if (closeParenIndex === missingIndex) return true;

  return containsCommentMarker(signatureText.slice(closeParenIndex + ")".length));
};

const isNonArrowFunctionBoundary = (node: Node): boolean =>
  isFunctionLikeDeclaration(node) && !isArrowFunction(node);

const isWithinNestedNonArrowFunction = (node: Node, functionNode: FunctionToConvert): boolean => {
  let current: Node = node.parent;

  while (current.kind !== SyntaxKind.SourceFile) {
    if (isSameNode(current, functionNode)) return false;
    if (isNonArrowFunctionBoundary(current)) return true;

    current = current.parent;
  }

  return false;
};

const hasLexicalFunctionHazard = (functionNode: FunctionToConvert): boolean =>
  collectNodes(functionNode, (node): node is Node => !isSameNode(node, functionNode)).some(
    (node) => {
      if (isWithinNestedNonArrowFunction(node, functionNode)) return false;

      if (
        isThisExpression(node) ||
        isThisTypeNode(node) ||
        isMetaProperty(node) ||
        node.kind === SyntaxKind.SuperKeyword
      )
        return true;

      return isIdentifier(node) && node.text === "arguments";
    },
  );

const hasLeadingOrTrailingComments = (sourceFile: SourceFile, node: Node): boolean =>
  (getLeadingCommentRanges(sourceFile.text, node.pos)?.length ?? 0) > 0 ||
  (getTrailingCommentRanges(sourceFile.text, node.end)?.length ?? 0) > 0;

const statementHasExportModifier = (statement: Node): boolean => {
  if (
    isClassDeclaration(statement) ||
    isEnumDeclaration(statement) ||
    isFunctionDeclaration(statement) ||
    isInterfaceDeclaration(statement) ||
    isModuleDeclaration(statement) ||
    isTypeAliasDeclaration(statement) ||
    isVariableStatement(statement)
  )
    return hasModifier(statement, SyntaxKind.ExportKeyword);

  return false;
};

const isClearModuleSourceFile = (sourceFile: SourceFile): boolean =>
  sourceFile.statements.some((statement) => {
    if (
      isExportAssignment(statement) ||
      isExportDeclaration(statement) ||
      isImportDeclaration(statement) ||
      isImportEqualsDeclaration(statement)
    )
      return true;

    return statementHasExportModifier(statement);
  });

const hasNamespaceMerge = (sourceFile: SourceFile, functionName: string): boolean =>
  collectNodes(sourceFile, isModuleDeclaration).some(
    (declaration) => textForNode(sourceFile, declaration.name) === functionName,
  );

const isReferenceInNewExpression = (reference: Node): boolean => {
  const { parent } = reference;

  return isNewExpression(parent) && isSameNode(parent.expression, reference);
};

const isReferenceToPrototype = (reference: Node): boolean => {
  const { parent } = reference;

  return (
    isPropertyAccessExpression(parent) &&
    parent.name.kind === SyntaxKind.Identifier &&
    parent.name.text === "prototype" &&
    isSameNode(parent.expression, reference)
  );
};

const getIdentifierReferences = (sourceFile: SourceFile, name: string): readonly Identifier[] =>
  collectNodes(sourceFile, isIdentifier).filter((identifier) => identifier.text === name);

const hasUnsafeFunctionDeclarationReference = (
  sourceFile: SourceFile,
  functionDeclaration: FunctionDeclaration,
  nameNode: Identifier,
): boolean => {
  const declarationStart = getNodeStart(sourceFile, functionDeclaration);

  return getIdentifierReferences(sourceFile, nameNode.text).some((reference) => {
    if (isSameNode(reference, nameNode)) return false;
    if (getNodeStart(sourceFile, reference) < declarationStart) return true;

    return isReferenceInNewExpression(reference) || isReferenceToPrototype(reference);
  });
};

const hasFunctionOverloadDeclaration = (
  sourceFile: SourceFile,
  functionDeclaration: FunctionDeclaration,
  functionName: string,
): boolean =>
  collectNodes(sourceFile, isFunctionDeclaration).some(
    (declaration) =>
      !isSameNode(declaration, functionDeclaration) &&
      declaration.parent.kind === SyntaxKind.SourceFile &&
      declaration.body === undefined &&
      declaration.name?.text === functionName,
  );

const buildArrowFunctionText = (
  sourceFile: SourceFile,
  functionNode: FunctionToConvert,
): string | undefined => {
  const typeParametersText = getTypeParametersText(sourceFile, functionNode.typeParameters);
  const parametersText = getParametersText(sourceFile, functionNode.parameters);
  const returnTypeText = getReturnTypeText(sourceFile, functionNode.type);
  const { body } = functionNode;

  if (
    typeParametersText === undefined ||
    parametersText === undefined ||
    returnTypeText === undefined ||
    body === undefined
  )
    return undefined;
  if (hasCommentBetweenSignatureAndBody(sourceFile, functionNode)) return undefined;

  const asyncText = hasModifier(functionNode, SyntaxKind.AsyncKeyword) ? "async " : emptyText;
  const bodyText = textForNode(sourceFile, body);

  return `${asyncText + typeParametersText + parametersText + returnTypeText} => ${bodyText}`;
};

const buildFunctionDeclarationReplacement = (
  sourceFile: SourceFile,
  functionDeclaration: FunctionDeclaration,
  options: ConstArrowFunctionsOptions,
): TextReplacement | undefined => {
  const nameNode = functionDeclaration.name;

  if (nameNode === undefined) return undefined;
  if (functionDeclaration.parent.kind !== SyntaxKind.SourceFile) return undefined;
  if (!isClearModuleSourceFile(sourceFile)) return undefined;
  if (functionDeclaration.body === undefined) return undefined;
  if (hasModifier(functionDeclaration, SyntaxKind.DeclareKeyword)) return undefined;
  if (hasModifier(functionDeclaration, SyntaxKind.DefaultKeyword)) return undefined;
  if (hasFunctionOverloadDeclaration(sourceFile, functionDeclaration, nameNode.text))
    return undefined;
  if (
    hasModifier(functionDeclaration, SyntaxKind.ExportKeyword) &&
    options.includeExportedFunctions !== true
  )
    return undefined;
  if (functionDeclaration.asteriskToken !== undefined) return undefined;
  if (hasLeadingOrTrailingComments(sourceFile, functionDeclaration)) return undefined;
  if (hasLexicalFunctionHazard(functionDeclaration)) return undefined;
  if (hasUnsafeFunctionDeclarationReference(sourceFile, functionDeclaration, nameNode))
    return undefined;
  if (hasNamespaceMerge(sourceFile, nameNode.text)) return undefined;

  const arrowFunctionText = buildArrowFunctionText(sourceFile, functionDeclaration);

  if (arrowFunctionText === undefined) return undefined;

  const exportText = hasModifier(functionDeclaration, SyntaxKind.ExportKeyword)
    ? "export "
    : emptyText;

  return {
    end: functionDeclaration.end,
    messageId: "convert",
    replacementText: `${exportText}const ${nameNode.text} = ${arrowFunctionText};`,
    start: getNodeStart(sourceFile, functionDeclaration),
  };
};

const getConstVariableInitializer = (
  sourceFile: SourceFile,
  functionExpression: FunctionExpression,
): VariableDeclaration | undefined => {
  const { parent } = functionExpression;

  if (!isVariableDeclaration(parent)) return undefined;
  if (!isSameNode(parent.initializer, functionExpression)) return undefined;
  if (!isVariableDeclarationList(parent.parent)) return undefined;

  const declarationKeyword = sourceFile.text
    .slice(
      getNodeStart(sourceFile, parent.parent),
      getNodeStart(sourceFile, parent.parent) + "const".length,
    )
    .trim();

  return declarationKeyword === "const" ? parent : undefined;
};

const hasUnsafeFunctionExpressionReference = (
  sourceFile: SourceFile,
  functionExpression: FunctionExpression,
): boolean => {
  const variableDeclaration = getConstVariableInitializer(sourceFile, functionExpression);
  const nameNode = variableDeclaration?.name;

  if (nameNode === undefined || !isIdentifier(nameNode)) return true;

  return getIdentifierReferences(sourceFile, nameNode.text).some((reference) => {
    if (isSameNode(reference, nameNode)) return false;

    return isReferenceInNewExpression(reference) || isReferenceToPrototype(reference);
  });
};

const buildFunctionExpressionReplacement = (
  sourceFile: SourceFile,
  functionExpression: FunctionExpression,
): TextReplacement | undefined => {
  if (getConstVariableInitializer(sourceFile, functionExpression) === undefined) return undefined;
  if (functionExpression.name !== undefined) return undefined;
  if (functionExpression.asteriskToken !== undefined) return undefined;
  if (hasLeadingOrTrailingComments(sourceFile, functionExpression)) return undefined;
  if (hasLexicalFunctionHazard(functionExpression)) return undefined;
  if (hasUnsafeFunctionExpressionReference(sourceFile, functionExpression)) return undefined;

  const arrowFunctionText = buildArrowFunctionText(sourceFile, functionExpression);

  return arrowFunctionText === undefined
    ? undefined
    : {
        end: functionExpression.end,
        messageId: "convert",
        replacementText: arrowFunctionText,
        start: getNodeStart(sourceFile, functionExpression),
      };
};

const parseOptions = (context: RuleContext): ConstArrowFunctionsOptions => {
  const [rawOptions] = context.options;
  const options = isOptionsRecord(rawOptions) ? rawOptions : {};

  return { includeExportedFunctions: options["includeExportedFunctions"] === true };
};

export const collectConstArrowFunctionReplacements = (
  context: RuleContext,
  sourceFile: SourceFile,
): readonly TextReplacement[] => {
  const options = parseOptions(context);
  const functionExpressionReplacements = collectNodes(sourceFile, isFunctionExpression).flatMap(
    (functionExpression) =>
      buildFunctionExpressionReplacement(sourceFile, functionExpression) ?? [],
  );
  const functionDeclarationReplacements = collectNodes(sourceFile, isFunctionDeclaration).flatMap(
    (functionDeclaration) =>
      buildFunctionDeclarationReplacement(sourceFile, functionDeclaration, options) ?? [],
  );

  return [...functionExpressionReplacements, ...functionDeclarationReplacements];
};

export const constArrowFunctionsRule: Rule = createSourceRule({
  collectReplacements: collectConstArrowFunctionReplacements,
  description: constArrowDescription,
  message: constArrowMessage,
  schema: [
    {
      additionalProperties: false,
      properties: { includeExportedFunctions: { type: "boolean" } },
      type: "object",
    },
  ],
});
