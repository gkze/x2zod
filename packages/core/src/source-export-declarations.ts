import type { DeclarationExportMode } from "./source-options";
import { compareCodeUnits } from "./string-order";
import { zodSymbol } from "./zod-plan";
import type { ZodDeclaration, ZodEmissionModule, ZodSymbol } from "./zod-plan";
import {
  collectZodExpressionReferences,
  collectZodRuntimeProgramReferences,
} from "./zod-plan-analysis";

type ExportDeclarationProjection = Readonly<{
  exportOrigins: ReadonlyMap<ZodSymbol, ZodDeclaration>;
  module: ZodEmissionModule;
}>;

// Public entrypoint behavior must not affect references within the generated module.
export const projectExportDeclarations = (
  module: ZodEmissionModule,
  mode: DeclarationExportMode,
): ExportDeclarationProjection => {
  const symbols = new Set(module.declarations.map((declaration) => declaration.symbol));
  const declarations: ZodDeclaration[] = module.declarations.map((declaration) => ({
    expression: declaration.expression,
    nameHints: declaration.nameHints,
    symbol: declaration.symbol,
  }));
  const exportOrigins = new Map<ZodSymbol, ZodDeclaration>();
  let { root } = module;
  for (const declaration of module.declarations.toSorted((left, right) =>
    compareCodeUnits(left.symbol, right.symbol),
  ))
    if (
      declaration.exportExpression !== undefined &&
      (mode === "all" || declaration.symbol === module.root)
    ) {
      let symbol = zodSymbol(`${declaration.symbol}:export`);
      while (symbols.has(symbol)) symbol = zodSymbol(`${symbol}:export`);
      symbols.add(symbol);
      exportOrigins.set(symbol, declaration);
      declarations.push({
        expression: declaration.exportExpression,
        nameHints: declaration.nameHints,
        symbol,
      });
      if (declaration.symbol === module.root) root = symbol;
    }
  const optionalInternals = new Set(
    module.declarations.flatMap((declaration) =>
      declaration.exportExpression === undefined ? [] : [declaration.symbol],
    ),
  );
  const declarationsBySymbol = new Map(
    declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const pending = declarations
    .filter((declaration) => !optionalInternals.has(declaration.symbol))
    .map((declaration) => declaration.symbol);
  const usedSymbols = new Set<ZodSymbol>();
  while (pending.length > 0) {
    const symbol = pending.pop();
    if (symbol !== undefined && !usedSymbols.has(symbol)) {
      usedSymbols.add(symbol);
      const declaration = declarationsBySymbol.get(symbol);
      if (declaration !== undefined)
        pending.push(...collectZodExpressionReferences(declaration.expression));
    }
  }
  const emittedDeclarations = declarations.filter((declaration) =>
    usedSymbols.has(declaration.symbol),
  );
  const usedPrograms = new Set(
    emittedDeclarations.flatMap((declaration) =>
      collectZodRuntimeProgramReferences(declaration.expression),
    ),
  );
  const exportPrograms = new Set(
    module.declarations.flatMap((declaration) =>
      declaration.exportExpression === undefined
        ? []
        : collectZodRuntimeProgramReferences(declaration.exportExpression),
    ),
  );
  return {
    exportOrigins,
    module: {
      declarations: emittedDeclarations,
      root,
      runtimePrograms: module.runtimePrograms.filter(
        (program) => !exportPrograms.has(program.id) || usedPrograms.has(program.id),
      ),
    },
  };
};
