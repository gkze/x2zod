import {
  NodeFlags,
  SyntaxKind,
  isArrayBindingPattern,
  isArrowFunction,
  isAwaitExpression,
  isBindingElement,
  isBlock,
  isBreakStatement,
  isCaseBlock,
  isCatchClause,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isComputedPropertyName,
  isConstructorDeclaration,
  isContinueStatement,
  isDebuggerStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportExpression,
  isLabeledStatement,
  isMetaProperty,
  isMethodDeclaration,
  isObjectBindingPattern,
  isParameterDeclaration,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSetAccessorDeclaration,
  isShorthandPropertyAssignment,
  isSuperExpression,
  isThisExpression,
  isTypeNode,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  isWithStatement,
  isYieldExpression,
  skipOuterExpressions,
} from "@typescript/native-preview/unstable/ast";
import type {
  ArrowFunction,
  BindingName,
  Block,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  Node,
  SetAccessorDeclaration,
  Statement,
  VariableDeclarationList,
} from "@typescript/native-preview/unstable/ast";

import { compareCodeUnits } from "./string-order";

const lastItemOffset = 1;
const firstNonBlockScopedFlag = NodeFlags.BlockScoped + 1;
const noBlockScopedFlagRemainder: number = NodeFlags.None;

/**
 * ECMAScript intrinsic globals that a runtime predicate may use without declaring locally.
 *
 * Runtime programs are trusted compiler-extension code, not a security sandbox. This allowlist
 * keeps generated modules deterministic and self-contained by requiring every other identifier to
 * be bound inside the expression; it does not constrain effects reachable through allowed values.
 */
export const runtimeProgramIntrinsicGlobals = [
  "Array",
  "BigInt",
  "Error",
  "Map",
  "Number",
  "Object",
  "RegExp",
  "Set",
  "String",
  "isNaN",
  "undefined",
] as const;

type RuntimeProgramExpressionAnalysis = Readonly<{
  abiCompatible: boolean;
  callable: boolean;
  forbiddenSyntax: readonly string[];
  freeIdentifiers: readonly string[];
}>;

type LexicalScope = Readonly<{ bindings: Set<string>; parent?: LexicalScope | undefined }>;

type AnalysisState = Readonly<{ forbiddenSyntax: Set<string>; freeIdentifiers: Set<string> }>;

type VisitNode = (node: Node, scope: LexicalScope, parent?: Node) => void;

type VisitValueContext = Readonly<{
  parent: Node | undefined;
  scope: LexicalScope;
  state: AnalysisState;
  visit: VisitNode;
}>;

type FunctionLike =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | GetAccessorDeclaration
  | MethodDeclaration
  | SetAccessorDeclaration;
type PredicateFunction = ArrowFunction | FunctionExpression;

const intrinsicGlobals: ReadonlySet<string> = new Set(runtimeProgramIntrinsicGlobals);

const isRuntimeFunction = (node: Node): node is FunctionLike =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isGetAccessorDeclaration(node) ||
  isMethodDeclaration(node) ||
  isSetAccessorDeclaration(node);

const bindingNames = (name: BindingName): readonly string[] => {
  if (isIdentifier(name)) return [name.text];
  if (!isArrayBindingPattern(name) && !isObjectBindingPattern(name)) return [];
  return name.elements.flatMap((element) =>
    isBindingElement(element) && element.name !== undefined ? bindingNames(element.name) : [],
  );
};

const addBindings = (scope: LexicalScope, name: BindingName): void => {
  for (const binding of bindingNames(name)) scope.bindings.add(binding);
};

const isBlockScoped = (declarations: VariableDeclarationList): boolean =>
  declarations.flags % firstNonBlockScopedFlag !== noBlockScopedFlagRemainder;

const collectFunctionVariableBindings = (node: Node, scope: LexicalScope): void => {
  if (isRuntimeFunction(node)) return;
  if (isVariableDeclarationList(node) && !isBlockScoped(node))
    for (const declaration of node.declarations) addBindings(scope, declaration.name);
  node.forEachChild((child) => {
    collectFunctionVariableBindings(child, scope);
  });
};

const collectStatementBindings = (statements: readonly Statement[], scope: LexicalScope): void => {
  for (const statement of statements)
    if (isVariableStatement(statement) && isBlockScoped(statement.declarationList))
      for (const declaration of statement.declarationList.declarations)
        addBindings(scope, declaration.name);
    else if (isFunctionDeclaration(statement) && statement.name !== undefined)
      scope.bindings.add(statement.name.text);
    else if (isClassDeclaration(statement) && statement.name !== undefined)
      scope.bindings.add(statement.name.text);
};

const hasBinding = (scope: LexicalScope, name: string): boolean => {
  let current: LexicalScope | undefined = scope;
  while (current !== undefined) {
    if (current.bindings.has(name)) return true;
    current = current.parent;
  }
  return false;
};

const isAsyncFunction = (node: FunctionLike): boolean =>
  node.modifiers?.some((modifier) => modifier.kind === SyntaxKind.AsyncKeyword) === true;

const isSynchronousFunctionExpression = (node: Node): node is ArrowFunction | FunctionExpression =>
  (isArrowFunction(node) || isFunctionExpression(node)) &&
  !isAsyncFunction(node) &&
  node.asteriskToken === undefined;

const functionReturnStatements = (body: Block): readonly Node[] => {
  const returns: Node[] = [];
  const collect = (node: Node): void => {
    if (isRuntimeFunction(node)) return;
    if (isReturnStatement(node)) returns.push(node);
    else node.forEachChild(collect);
  };
  for (const statement of body.statements) collect(statement);
  return returns;
};

const initializedPredicate = (expression: Expression): PredicateFunction | undefined => {
  const call = skipOuterExpressions(expression);
  if (
    !isCallExpression(call) ||
    call.questionDotToken !== undefined ||
    call.arguments.length > 0 ||
    (call.typeArguments?.length ?? 0) > 0
  )
    return undefined;
  const factory = skipOuterExpressions(call.expression);
  if (
    !isSynchronousFunctionExpression(factory) ||
    factory.parameters.length > 0 ||
    !isBlock(factory.body)
  )
    return undefined;
  const finalStatement = factory.body.statements.at(-lastItemOffset);
  if (
    finalStatement === undefined ||
    !isReturnStatement(finalStatement) ||
    finalStatement.expression === undefined
  )
    return undefined;
  const returnStatements = functionReturnStatements(factory.body);
  if (returnStatements.length !== 1 || returnStatements[0] !== finalStatement) return undefined;
  const returned = skipOuterExpressions(finalStatement.expression);
  return isSynchronousFunctionExpression(returned) ? returned : undefined;
};

const predicateFunction = (expression: Expression): PredicateFunction | undefined => {
  const callable = skipOuterExpressions(expression);
  return isSynchronousFunctionExpression(callable) ? callable : initializedPredicate(callable);
};

const hasCompatibleParameterType = (predicate: PredicateFunction): boolean => {
  const [parameter] = predicate.parameters;
  return (
    predicate.parameters.length <= 1 &&
    (parameter === undefined ||
      (isIdentifier(parameter.name) &&
        parameter.dotDotDotToken === undefined &&
        (parameter.type === undefined ||
          parameter.type.kind === SyntaxKind.AnyKeyword ||
          parameter.type.kind === SyntaxKind.UnknownKeyword)))
  );
};

const hasCompatibleReturnType = (predicate: PredicateFunction): boolean => {
  if (predicate.type !== undefined) return predicate.type.kind === SyntaxKind.BooleanKeyword;
  if (isBlock(predicate.body)) return false;
  const body = skipOuterExpressions(predicate.body);
  return body.kind === SyntaxKind.TrueKeyword || body.kind === SyntaxKind.FalseKeyword;
};

const isPredicateAbiCompatible = (predicate: PredicateFunction | undefined): boolean =>
  predicate !== undefined &&
  hasCompatibleParameterType(predicate) &&
  hasCompatibleReturnType(predicate);

const computedNameExpression = (node: Node): Expression | undefined => {
  if (
    (isPropertyAssignment(node) ||
      isMethodDeclaration(node) ||
      isGetAccessorDeclaration(node) ||
      isSetAccessorDeclaration(node)) &&
    isComputedPropertyName(node.name)
  )
    return node.name.expression;
  return undefined;
};

const forbiddenSyntaxName = (node: Node): string | undefined => {
  if (isAwaitExpression(node)) return "await";
  if (isDebuggerStatement(node)) return "debugger";
  if (isImportExpression(node)) return "dynamic import";
  if (isMetaProperty(node)) return "meta-property access";
  if (isSuperExpression(node)) return "super";
  if (isThisExpression(node)) return "this";
  if (isWithStatement(node)) return "with";
  if (isYieldExpression(node)) return "yield";
  if (isClassDeclaration(node) || isClassExpression(node)) return "class";
  if (isConstructorDeclaration(node)) return "class constructor";
  return undefined;
};

const bindingInitializers = (name: BindingName): readonly Expression[] => {
  if (isIdentifier(name)) return [];
  return name.elements.flatMap((element) => {
    if (!isBindingElement(element)) return [];
    return [
      ...(element.propertyName !== undefined && isComputedPropertyName(element.propertyName)
        ? [element.propertyName.expression]
        : []),
      ...(element.initializer === undefined ? [] : [element.initializer]),
      ...(element.name === undefined ? [] : bindingInitializers(element.name)),
    ];
  });
};

const visitFunctionNode = (
  node: FunctionLike,
  parentScope: LexicalScope,
  visit: VisitNode,
): void => {
  const functionScope: LexicalScope = { bindings: new Set(), parent: parentScope };
  if (!isArrowFunction(node)) functionScope.bindings.add("arguments");
  if ((isFunctionExpression(node) || isFunctionDeclaration(node)) && node.name !== undefined)
    functionScope.bindings.add(node.name.text);
  for (const parameter of node.parameters) addBindings(functionScope, parameter.name);
  if (node.body !== undefined) collectFunctionVariableBindings(node.body, functionScope);

  const name = computedNameExpression(node);
  if (name !== undefined) visit(name, parentScope, node);
  for (const parameter of node.parameters) {
    for (const initializer of bindingInitializers(parameter.name))
      visit(initializer, functionScope, parameter);
    if (parameter.initializer !== undefined) visit(parameter.initializer, functionScope, parameter);
  }
  if (node.body !== undefined) visit(node.body, functionScope, node);
};

const visitBlockNode = (node: Block, parentScope: LexicalScope, visit: VisitNode): void => {
  const blockScope: LexicalScope = { bindings: new Set(), parent: parentScope };
  collectStatementBindings(node.statements, blockScope);
  for (const statement of node.statements) visit(statement, blockScope, node);
};

const visitLoopNode = (node: Node, parentScope: LexicalScope, visit: VisitNode): void => {
  const loopScope: LexicalScope = { bindings: new Set(), parent: parentScope };
  const initializer =
    isForStatement(node) || isForInStatement(node) || isForOfStatement(node)
      ? node.initializer
      : undefined;
  if (initializer !== undefined && isVariableDeclarationList(initializer))
    for (const declaration of initializer.declarations) addBindings(loopScope, declaration.name);
  node.forEachChild((child) => {
    visit(child, loopScope, node);
  });
};

const visitScopedNode = (node: Node, scope: LexicalScope, visit: VisitNode): boolean => {
  if (isRuntimeFunction(node)) visitFunctionNode(node, scope, visit);
  else if (isBlock(node)) visitBlockNode(node, scope, visit);
  else if (isCatchClause(node)) {
    const catchScope: LexicalScope = { bindings: new Set(), parent: scope };
    if (node.variableDeclaration !== undefined)
      addBindings(catchScope, node.variableDeclaration.name);
    visit(node.block, catchScope, node);
  } else if (isForStatement(node) || isForInStatement(node) || isForOfStatement(node))
    visitLoopNode(node, scope, visit);
  else if (isCaseBlock(node)) {
    const caseScope: LexicalScope = { bindings: new Set(), parent: scope };
    collectStatementBindings(
      node.clauses.flatMap((clause) => clause.statements),
      caseScope,
    );
    node.forEachChild((child) => {
      visit(child, caseScope, node);
    });
  } else return false;
  return true;
};

const isNonReferenceIdentifier = (node: Node, parent: Node | undefined): boolean =>
  parent !== undefined &&
  ((isPropertyAccessExpression(parent) && parent.name === node) ||
    (isLabeledStatement(parent) && parent.label === node) ||
    (isBreakStatement(parent) && parent.label === node) ||
    (isContinueStatement(parent) && parent.label === node));

const recordFreeIdentifier = (name: string, scope: LexicalScope, state: AnalysisState): void => {
  if (!hasBinding(scope, name) && !intrinsicGlobals.has(name)) state.freeIdentifiers.add(name);
};

const visitValueNode = (
  node: Node,
  { parent, scope, state, visit }: VisitValueContext,
): boolean => {
  if (isVariableDeclaration(node)) {
    for (const initializer of bindingInitializers(node.name)) visit(initializer, scope, node);
    if (node.initializer !== undefined) visit(node.initializer, scope, node);
  } else if (isParameterDeclaration(node)) return true;
  else if (isPropertyAssignment(node)) {
    const name = computedNameExpression(node);
    if (name !== undefined) visit(name, scope, node);
    visit(node.initializer, scope, node);
  } else if (isIdentifier(node)) {
    if (!isNonReferenceIdentifier(node, parent)) recordFreeIdentifier(node.text, scope, state);
  } else if (isShorthandPropertyAssignment(node)) {
    if (isIdentifier(node.name)) recordFreeIdentifier(node.name.text, scope, state);
    if (node.objectAssignmentInitializer !== undefined)
      visit(node.objectAssignmentInitializer, scope, node);
  } else return false;
  return true;
};

const lexicalAnalysis = (
  expression: Expression,
): Pick<RuntimeProgramExpressionAnalysis, "forbiddenSyntax" | "freeIdentifiers"> => {
  const state: AnalysisState = { forbiddenSyntax: new Set(), freeIdentifiers: new Set() };

  const visit = (node: Node, scope: LexicalScope, parent?: Node): void => {
    if (isTypeNode(node)) return;
    const forbidden = forbiddenSyntaxName(node);
    if (forbidden !== undefined) state.forbiddenSyntax.add(forbidden);
    if (
      visitScopedNode(node, scope, visit) ||
      visitValueNode(node, { parent, scope, state, visit })
    )
      return;
    node.forEachChild((child) => {
      visit(child, scope, node);
    });
  };

  const rootScope: LexicalScope = { bindings: new Set() };
  visit(expression, rootScope);
  return {
    forbiddenSyntax: [...state.forbiddenSyntax].toSorted(compareCodeUnits),
    freeIdentifiers: [...state.freeIdentifiers].toSorted(compareCodeUnits),
  };
};

export const analyzeRuntimeProgramExpression = (
  expression: Expression,
): RuntimeProgramExpressionAnalysis => {
  const predicate = predicateFunction(expression);
  return {
    abiCompatible: isPredicateAbiCompatible(predicate),
    callable: predicate !== undefined,
    ...lexicalAnalysis(expression),
  };
};
