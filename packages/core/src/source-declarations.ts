import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { DeclarationExportMode } from "./source-options";
import { compareCodeUnits } from "./string-order";
import { isTypeScriptIdentifier, typeScriptIdentifierSegments } from "./typescript-identifiers";
import type { TypeScriptIdentifier, TypeScriptIdentifierAllocator } from "./typescript-identifiers";
import type { ZodDeclaration, ZodEmissionModule, ZodSymbol } from "./zod-plan";
import { collectZodExpressionReferences } from "./zod-plan-analysis";

export { projectExportDeclarations } from "./source-export-declarations";

const radixAlphanumeric = 36;
const schemaSuffix = "Schema";
const maximumBasicMultilingualPlaneCodePoint = 65_535;

export type NamedZodDeclaration = Readonly<{
  declaration: ZodDeclaration;
  exportSchema: boolean;
  schemaConstName: string;
}>;

type DeclarationNameResolution = Readonly<{
  declarations: readonly NamedZodDeclaration[];
  rootSchemaConstName: string;
  schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}>;

type SourceDeclarationOptions = Readonly<{
  declarationNameOverrides?: Readonly<Record<string, TypeScriptIdentifier>>;
  declarationExportMode: DeclarationExportMode;
  exportOrigins?: ReadonlyMap<ZodSymbol, ZodDeclaration> | undefined;
  identifierAllocator: TypeScriptIdentifierAllocator;
  typeName: TypeScriptIdentifier;
}>;
type ReserveSchemaNameRequest = Readonly<{
  candidate: string;
  forceSymbolSuffix: boolean;
  symbol: ZodSymbol;
  identifierAllocator: TypeScriptIdentifierAllocator;
}>;

const lowerFirst = (value: string): string => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;

const upperFirst = (value: string): string => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const schemaConstNameForType = (typeName: TypeScriptIdentifier): string =>
  `${lowerFirst(typeName)}${schemaSuffix}`;

const normalizedIdentifierBase = (value: string): string | undefined => {
  const parts = typeScriptIdentifierSegments(value);
  if (parts === undefined) return undefined;

  const [head, ...tail] = parts;
  if (head === undefined) return undefined;
  const base = `${lowerFirst(head)}${tail.map((part) => upperFirst(part)).join("")}`;
  return isTypeScriptIdentifier(base) ? base : `schema${upperFirst(base)}`;
};

const schemaNameCandidate = (
  declaration: ZodDeclaration,
  declarationNameOverrides: Readonly<Record<string, TypeScriptIdentifier>> = {},
): string => {
  const override = declarationNameOverrides[declaration.symbol];
  const hintBase = (override === undefined ? declaration.nameHints : [{ value: override }])
    .map((hint) => normalizedIdentifierBase(hint.value))
    .find((base) => base !== undefined);
  const symbolBase = normalizedIdentifierBase(declaration.symbol);
  const base = hintBase ?? symbolBase ?? "schema";
  return base.endsWith(schemaSuffix) ? base : `${base}${schemaSuffix}`;
};

const encodedSymbolSuffix = (symbol: ZodSymbol): string => {
  const codes: string[] = [];
  for (let index = 0; index < symbol.length; index += 1) {
    const codePoint = symbol.codePointAt(index);
    if (codePoint !== undefined) {
      codes.push(codePoint.toString(radixAlphanumeric));
      if (codePoint > maximumBasicMultilingualPlaneCodePoint) index += 1;
    }
  }
  return codes.join("");
};

const collisionSchemaName = (candidate: string, symbol: ZodSymbol): string => {
  const symbolBase = normalizedIdentifierBase(symbol) ?? "symbol";
  return `${candidate}For${upperFirst(symbolBase)}`;
};

const reserveSchemaName = ({
  candidate,
  forceSymbolSuffix,
  symbol,
  identifierAllocator,
}: ReserveSchemaNameRequest): string => {
  const encodedSuffix = encodedSymbolSuffix(symbol);
  const preferredName = forceSymbolSuffix ? collisionSchemaName(candidate, symbol) : candidate;
  return identifierAllocator.allocate(preferredName, (name) => `${name}X${encodedSuffix}`);
};

const candidateCounts = (candidates: readonly string[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();

  for (const candidate of candidates) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);

  return counts;
};

const orderedDeclarations = (module: ZodEmissionModule): readonly ZodDeclaration[] => {
  const declarationsBySymbol = new Map(
    module.declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const ordered: ZodDeclaration[] = [];
  const visited = new Set<ZodSymbol>();

  const visit = (symbol: ZodSymbol): void => {
    if (visited.has(symbol)) return;
    visited.add(symbol);

    const declaration = declarationsBySymbol.get(symbol);
    if (declaration === undefined) return;

    const references = collectZodExpressionReferences(declaration.expression)
      .filter((dependency) => declarationsBySymbol.has(dependency))
      .toSorted(compareCodeUnits);
    for (const reference of references) visit(reference);

    ordered.push(declaration);
  };

  const symbols = [...declarationsBySymbol.keys()].filter((symbol) => symbol !== module.root);
  for (const symbol of [...symbols.toSorted(compareCodeUnits), module.root]) visit(symbol);

  return ordered;
};

const missingNamedDeclaration = (symbol: ZodSymbol): never => {
  throw new Error(`Missing named declaration for symbol: ${symbol}`);
};

export const resolveZodDeclarationNames = (
  module: ZodEmissionModule,
  options: SourceDeclarationOptions,
): Result<DeclarationNameResolution> => {
  const rootDeclaration = module.declarations.find(
    (declaration) => declaration.symbol === module.root,
  );
  if (rootDeclaration === undefined)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module root is not declared: ${module.root}`,
      }),
    );

  const { identifierAllocator } = options;
  const schemaConstNames = new Map<ZodSymbol, string>();
  const rootSchemaConstName = reserveSchemaName({
    candidate: schemaConstNameForType(options.typeName),
    forceSymbolSuffix: false,
    identifierAllocator,
    symbol: module.root,
  });
  schemaConstNames.set(rootDeclaration.symbol, rootSchemaConstName);

  const internalSymbols = new Set(
    [...(options.exportOrigins?.values() ?? [])].map((declaration) => declaration.symbol),
  );
  const candidateEntries = module.declarations
    .filter((declaration) => declaration.symbol !== module.root)
    .map((declaration) => ({
      candidate: `${schemaNameCandidate(
        options.exportOrigins?.get(declaration.symbol) ?? declaration,
        options.declarationNameOverrides,
      )}${internalSymbols.has(declaration.symbol) ? "Internal" : ""}`,
      declaration,
    }));
  const counts = candidateCounts(candidateEntries.map((entry) => entry.candidate));
  const namedDeclarationsBySymbol = new Map<ZodSymbol, NamedZodDeclaration>();

  for (const { candidate, declaration } of candidateEntries.toSorted((left, right) =>
    compareCodeUnits(left.declaration.symbol, right.declaration.symbol),
  )) {
    const schemaConstName = reserveSchemaName({
      candidate,
      forceSymbolSuffix: candidate === rootSchemaConstName || counts.get(candidate) !== 1,
      symbol: declaration.symbol,
      identifierAllocator,
    });
    namedDeclarationsBySymbol.set(declaration.symbol, {
      declaration,
      exportSchema:
        options.declarationExportMode === "all" && !internalSymbols.has(declaration.symbol),
      schemaConstName,
    });
    schemaConstNames.set(declaration.symbol, schemaConstName);
  }

  return ok({
    declarations: orderedDeclarations(module).map((declaration) =>
      declaration.symbol === module.root
        ? { declaration: rootDeclaration, exportSchema: true, schemaConstName: rootSchemaConstName }
        : (namedDeclarationsBySymbol.get(declaration.symbol) ??
          missingNamedDeclaration(declaration.symbol)),
    ),
    rootSchemaConstName,
    schemaConstNames,
  });
};
