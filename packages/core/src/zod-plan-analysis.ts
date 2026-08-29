import type { ZodArgument, ZodExpression, ZodSymbol } from "./zod-plan";

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod IR node: ${JSON.stringify(value)}`);
};

const uniqueSymbols = (symbols: readonly ZodSymbol[]): readonly ZodSymbol[] => [
  ...new Set(symbols),
];

export const collectZodExpressionReferences = (expression: ZodExpression): readonly ZodSymbol[] => {
  const collectArgumentReferences = (argument: ZodArgument): readonly ZodSymbol[] => {
    switch (argument.kind) {
      case "array": {
        return uniqueSymbols(argument.elements.flatMap(collectArgumentReferences));
      }
      case "expression": {
        return collectZodExpressionReferences(argument.expression);
      }
      case "helper": {
        return [];
      }
      case "literal": {
        return [];
      }
      case "object": {
        return uniqueSymbols(
          argument.properties.flatMap((property) =>
            collectZodExpressionReferences(property.expression),
          ),
        );
      }
      default: {
        return assertNever(argument);
      }
    }
  };

  const baseReferences = (): readonly ZodSymbol[] => {
    switch (expression.kind) {
      case "factory": {
        return expression.args.flatMap(collectArgumentReferences);
      }
      case "reference": {
        return [expression.symbol];
      }
      case "wrapper": {
        return collectZodExpressionReferences(expression.expression);
      }
      default: {
        return assertNever(expression);
      }
    }
  };

  return uniqueSymbols([
    ...baseReferences(),
    ...expression.calls.flatMap((call) => call.args.flatMap(collectArgumentReferences)),
  ]);
};
