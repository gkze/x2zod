import type { ZodRuntimeProgramId } from "./runtime-program";
import type { ZodEmissionModule, ZodExpression, ZodSymbol } from "./zod-plan";
import { walkZodExpression } from "./zod-plan-walker";

export const collectZodExpressionReferences = (expression: ZodExpression): readonly ZodSymbol[] => {
  const references = new Set<ZodSymbol>();
  walkZodExpression(expression, {
    expression: (current) => {
      if (current.kind === "reference") references.add(current.symbol);
      return false;
    },
  });
  return [...references];
};

const valueDescendingFactories = new Set(["array", "object", "record", "tuple"]);

export const collectSameValueZodExpressionReferences = (
  expression: ZodExpression,
): readonly ZodSymbol[] => {
  const references = new Set<ZodSymbol>();
  walkZodExpression(expression, {
    argument: (_argument, context) => (context.call === undefined ? false : "skip"),
    expression: (current) => {
      if (current.kind === "reference") references.add(current.symbol);
      return current.kind === "factory" && valueDescendingFactories.has(current.factory)
        ? "skip"
        : false;
    },
  });
  return [...references];
};

const collectDeclarationCyclePeers = (
  module: ZodEmissionModule,
  collectReferences: (expression: ZodExpression) => readonly ZodSymbol[],
): ReadonlyMap<ZodSymbol, ReadonlySet<ZodSymbol>> => {
  const declarations = new Map(
    module.declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const indices = new Map<ZodSymbol, number>();
  const lowLinks = new Map<ZodSymbol, number>();
  const onStack = new Set<ZodSymbol>();
  const stack: ZodSymbol[] = [];
  const peersBySymbol = new Map<ZodSymbol, ReadonlySet<ZodSymbol>>();
  let nextIndex = 0;

  const visit = (symbol: ZodSymbol): void => {
    const index = nextIndex;
    nextIndex += 1;
    indices.set(symbol, index);
    lowLinks.set(symbol, index);
    onStack.add(symbol);
    stack.push(symbol);

    const declaration = declarations.get(symbol);
    const references =
      declaration === undefined
        ? []
        : collectReferences(declaration.expression).filter((reference) =>
            declarations.has(reference),
          );
    for (const reference of references)
      if (!indices.has(reference)) {
        visit(reference);
        lowLinks.set(symbol, Math.min(lowLinks.get(symbol) ?? index, lowLinks.get(reference) ?? 0));
      } else if (onStack.has(reference))
        lowLinks.set(symbol, Math.min(lowLinks.get(symbol) ?? index, indices.get(reference) ?? 0));

    if (lowLinks.get(symbol) !== index) return;
    const component: ZodSymbol[] = [];
    let member = stack.pop();
    while (member !== undefined) {
      onStack.delete(member);
      component.push(member);
      if (member === symbol) break;
      member = stack.pop();
    }

    const selfReference =
      component.length === 1 && references.some((reference) => reference === symbol);
    if (component.length > 1 || selfReference) {
      const peers = new Set(component);
      for (const componentSymbol of component) peersBySymbol.set(componentSymbol, peers);
    }
  };

  for (const symbol of declarations.keys()) if (!indices.has(symbol)) visit(symbol);
  return peersBySymbol;
};

export const collectCyclicZodDeclarationPeers = (
  module: ZodEmissionModule,
): ReadonlyMap<ZodSymbol, ReadonlySet<ZodSymbol>> =>
  collectDeclarationCyclePeers(module, collectZodExpressionReferences);

export const collectSameValueCyclicZodDeclarationPeers = (
  module: ZodEmissionModule,
): ReadonlyMap<ZodSymbol, ReadonlySet<ZodSymbol>> =>
  collectDeclarationCyclePeers(module, collectSameValueZodExpressionReferences);

export const collectZodRuntimeProgramReferences = (
  expression: ZodExpression,
): readonly ZodRuntimeProgramId[] => {
  const references = new Set<ZodRuntimeProgramId>();
  walkZodExpression(expression, {
    expression: (current) => {
      if (current.kind === "runtime-guard") references.add(current.program);
      return false;
    },
    siblingOrder: "reverse",
  });
  return [...references];
};
