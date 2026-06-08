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

  return uniqueSymbols([
    ...(expression.kind === "reference"
      ? [expression.symbol]
      : expression.args.flatMap(collectArgumentReferences)),
    ...expression.calls.flatMap((call) => call.args.flatMap(collectArgumentReferences)),
  ]);
};
