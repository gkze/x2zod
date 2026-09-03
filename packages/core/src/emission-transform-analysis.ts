import type { ZodEmissionModule, ZodExpression, ZodSymbol } from "./zod-plan";
import { zodMethodMetadataFor } from "./zod-plan-metadata";
import { walkZodExpression } from "./zod-plan-walker";

const expressionChanges = (
  expression: ZodExpression,
  decodedKey: (key: string) => string,
  transformedSymbols: ReadonlySet<ZodSymbol>,
): boolean =>
  walkZodExpression(expression, {
    argument: (argument, { call, expression: owner }) =>
      argument.kind === "literal" &&
      typeof argument.value === "string" &&
      call !== undefined &&
      owner.kind === "factory" &&
      owner.factory === "object" &&
      zodMethodMetadataFor(call.method)?.printArgument === "requiredKeys" &&
      decodedKey(argument.value) !== argument.value,
    expression: (current) => {
      if (current.kind === "reference" && transformedSymbols.has(current.symbol)) return true;
      if (current.kind !== "factory" || current.factory !== "object") return false;
      const [objectShape] = current.args;
      return (
        objectShape?.kind === "object" &&
        objectShape.properties.some((property) => decodedKey(property.key) !== property.key)
      );
    },
  });

export const collectTransformedSymbols = (
  module: ZodEmissionModule,
  decodedKey: (key: string) => string,
): ReadonlySet<ZodSymbol> => {
  const transformedSymbols = new Set<ZodSymbol>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of module.declarations)
      if (
        !transformedSymbols.has(declaration.symbol) &&
        expressionChanges(declaration.expression, decodedKey, transformedSymbols)
      ) {
        transformedSymbols.add(declaration.symbol);
        changed = true;
      }
  }
  return transformedSymbols;
};
