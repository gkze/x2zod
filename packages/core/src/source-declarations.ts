import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { DeclarationExportMode, TypeScriptIdentifier } from "./source";
import type { ZodDeclaration, ZodEmissionModule, ZodSymbol } from "./zod-plan";
import { collectZodExpressionReferences } from "./zod-plan-analysis";

const identifierPattern = /^[A-Za-z_$][\w$]*$/u;
const identifierSegmentPattern = /[A-Za-z0-9_$]+/gu;
const radixAlphanumeric = 36;
const schemaSuffix = "Schema";
const maximumBasicMultilingualPlaneCodePoint = 65_535;
const sortBefore = -1;
const sortEqual = 0;
const sortAfter = 1;

export type NamedZodDeclaration = Readonly<{
  declaration: ZodDeclaration;
  exportSchema: boolean;
  schemaConstName: string;
}>;

export type DeclarationNameResolution = Readonly<{
  declarations: readonly NamedZodDeclaration[];
  rootSchemaConstName: string;
  schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}>;

type SourceDeclarationOptions = Readonly<{
  declarationExportMode: DeclarationExportMode;
  typeName: TypeScriptIdentifier;
}>;
type ReserveSchemaNameRequest = Readonly<{
  candidate: string;
  forceSymbolSuffix: boolean;
  symbol: ZodSymbol;
  usedNames: Set<string>;
}>;

const lowerFirst = (value: string): string => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;

const upperFirst = (value: string): string => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

const compareStrings = (left: string, right: string): number => {
  if (left < right) return sortBefore;
  if (left > right) return sortAfter;
  return sortEqual;
};

const schemaConstNameForType = (typeName: TypeScriptIdentifier): string =>
  `${lowerFirst(typeName)}${schemaSuffix}`;

const normalizedIdentifierBase = (value: string): string | undefined => {
  const parts = value.match(identifierSegmentPattern);
  if (parts === null) return undefined;

  const [head, ...tail] = parts;
  const base = `${lowerFirst(head)}${tail.map((part) => upperFirst(part)).join("")}`;
  return identifierPattern.test(base) ? base : `schema${upperFirst(base)}`;
};

const schemaNameCandidate = (declaration: ZodDeclaration): string => {
  const hintBase = declaration.nameHints
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
  usedNames,
}: ReserveSchemaNameRequest): string => {
  const encodedSuffix = encodedSymbolSuffix(symbol);
  let name = forceSymbolSuffix ? collisionSchemaName(candidate, symbol) : candidate;

  while (usedNames.has(name)) name = `${name}X${encodedSuffix}`;

  usedNames.add(name);
  return name;
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
      .toSorted(compareStrings);
    for (const reference of references) visit(reference);

    ordered.push(declaration);
  };

  const symbols = [...declarationsBySymbol.keys()].filter((symbol) => symbol !== module.root);
  for (const symbol of [...symbols.toSorted(compareStrings), module.root]) visit(symbol);

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

  const usedNames = new Set<string>();
  const schemaConstNames = new Map<ZodSymbol, string>();
  const rootSchemaConstName = schemaConstNameForType(options.typeName);
  usedNames.add(rootSchemaConstName);
  schemaConstNames.set(rootDeclaration.symbol, rootSchemaConstName);

  const candidateEntries = module.declarations
    .filter((declaration) => declaration.symbol !== module.root)
    .map((declaration) => ({ candidate: schemaNameCandidate(declaration), declaration }));
  const counts = candidateCounts(candidateEntries.map((entry) => entry.candidate));
  const namedDeclarationsBySymbol = new Map<ZodSymbol, NamedZodDeclaration>();

  for (const { candidate, declaration } of candidateEntries.toSorted((left, right) =>
    compareStrings(left.declaration.symbol, right.declaration.symbol),
  )) {
    const schemaConstName = reserveSchemaName({
      candidate,
      forceSymbolSuffix: candidate === rootSchemaConstName || counts.get(candidate) !== 1,
      symbol: declaration.symbol,
      usedNames,
    });
    namedDeclarationsBySymbol.set(declaration.symbol, {
      declaration,
      exportSchema: options.declarationExportMode === "all",
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
