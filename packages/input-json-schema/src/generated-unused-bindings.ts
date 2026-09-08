import {
  isBindingElement,
  isIdentifier,
  isFunctionDeclaration,
  isParameterDeclaration,
  isObjectBindingPattern,
  isVariableStatement,
} from "@typescript/native-preview/unstable/ast";
import type {
  FunctionDeclaration,
  Node,
  ParameterDeclaration,
} from "@typescript/native-preview/unstable/ast";
import {
  createExpressionStatement,
  createIdentifier,
  updateParameterDeclaration,
  updateFunctionDeclaration,
} from "@typescript/native-preview/unstable/ast/factory";
import { visitEachChild } from "@typescript/native-preview/unstable/ast/visitor";

type UnusedDiagnostic = Readonly<{ code: number; pos: number; end: number }>;
const unusedDeclarationCode = 6133;
const unusedBindingPatternCode = 6198;
const unusedCodes: ReadonlySet<number> = new Set([unusedDeclarationCode, unusedBindingPatternCode]);

const ignoredParameter = (parameter: ParameterDeclaration, name: string): ParameterDeclaration =>
  updateParameterDeclaration(
    parameter,
    parameter.modifiers,
    parameter.dotDotDotToken,
    createIdentifier(name),
    parameter.questionToken,
    parameter.type,
    parameter.initializer,
  );

const containsDataIdentifier = (node: Node): boolean =>
  (isIdentifier(node) && node.text === "data") ||
  node.forEachChild(containsDataIdentifier) === true;

// Removing an unused rootData default can make Ajv's positional data argument unused too.
const removeUnusedDataParameter = (node: FunctionDeclaration): FunctionDeclaration => {
  const [first, ...rest] = node.parameters;
  if (
    first === undefined ||
    !isIdentifier(first.name) ||
    first.name.text !== "data" ||
    (node.body !== undefined && containsDataIdentifier(node.body)) ||
    rest.some((parameter) => containsDataIdentifier(parameter))
  )
    return node;
  return updateFunctionDeclaration(
    node,
    node.modifiers,
    node.asteriskToken,
    node.name,
    node.typeParameters,
    [ignoredParameter(first, "_data"), ...rest],
    node.type,
    node.body,
  );
};

const isAjvContextBinding = (node: Node): boolean => {
  const pattern = node.parent;
  if (!isObjectBindingPattern(pattern) || !isParameterDeclaration(pattern.parent)) return false;
  const owner = pattern.parent.parent;
  return (
    isFunctionDeclaration(owner) &&
    owner.name !== undefined &&
    /^validate\d+$/u.test(owner.name.text)
  );
};

// Use the compiler's binding analysis: spelling-based counts confuse property names and shadowing.
export const removeGeneratedUnusedBindings = (
  root: Node,
  diagnostics: readonly UnusedDiagnostic[],
): Node => {
  const unused = diagnostics.filter((diagnostic) => unusedCodes.has(diagnostic.code));
  const isUnused = (node: Node): boolean =>
    unused.some((diagnostic) => diagnostic.pos <= node.getStart() && diagnostic.end >= node.end);
  const visit = (node: Node): Node | undefined => {
    if (
      isBindingElement(node) &&
      node.name !== undefined &&
      isAjvContextBinding(node) &&
      isUnused(node.name)
    )
      return undefined;
    if (isParameterDeclaration(node) && isIdentifier(node.name) && isUnused(node.name))
      return ignoredParameter(node, `_${node.name.text}`);
    if (isVariableStatement(node)) {
      const { declarations } = node.declarationList;
      if (declarations.length === 1) {
        const [declaration] = declarations;
        if (
          declaration !== undefined &&
          isIdentifier(declaration.name) &&
          isUnused(declaration.name)
        ) {
          // Ajv's unused schema constants and export aliases have no initialization effects.
          if (/^(?:schema\d+|validate)$/u.test(declaration.name.text)) return undefined;
          // Preserve effects and dependency references for other generated initializers.
          return declaration.initializer === undefined
            ? undefined
            : createExpressionStatement(visitEachChild(declaration.initializer, visit));
        }
      }
    }
    if (isFunctionDeclaration(node)) return removeUnusedDataParameter(visitEachChild(node, visit));
    return visitEachChild(node, visit);
  };
  return visitEachChild(root, visit);
};
