import {
  isExportAssignment,
  isExportDeclaration,
  isIdentifier,
  isNamedExports,
  SyntaxKind,
} from "@typescript/native-preview/unstable/ast";
import type {
  ExportSpecifier,
  Identifier,
  Node,
  SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type { Checker } from "@typescript/native-preview/unstable/sync";

import { collectNodes } from "#text";

interface NodeWithModifiers extends Node {
  readonly modifiers?: readonly Node[];
}

export interface ExportedLocalSymbols {
  readonly checker: Checker;
  readonly symbolIds: ReadonlySet<number>;
}

interface ExportSpecifierContext {
  readonly checker: Checker;
  readonly includeTypeOnly: boolean;
  readonly statementIsTypeOnly: boolean;
  readonly symbolIds: Set<number>;
}

const hasModifierList = (node: Node): node is NodeWithModifiers => "modifiers" in node;

export const hasModifier = (node: Node, kind: SyntaxKind): boolean => {
  const modifiers = hasModifierList(node) ? node.modifiers : undefined;

  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
};

const addResolvedSymbolId = (
  checker: Checker,
  identifier: Identifier,
  symbolIds: Set<number>,
): void => {
  const symbol = checker.getResolvedSymbol(identifier);

  if (symbol !== undefined) symbolIds.add(symbol.id);
};

const addExportSpecifierSymbolId = (
  specifierContext: ExportSpecifierContext,
  specifier: ExportSpecifier,
): void => {
  if (
    !specifierContext.includeTypeOnly &&
    (specifierContext.statementIsTypeOnly || specifier.isTypeOnly)
  )
    return;

  const localName = specifier.propertyName ?? specifier.name;

  if (isIdentifier(localName))
    addResolvedSymbolId(specifierContext.checker, localName, specifierContext.symbolIds);
};

export const collectExportedLocalSymbolIds = (
  sourceFile: SourceFile,
  checker: Checker,
  includeTypeOnly: boolean,
): ReadonlySet<number> => {
  const symbolIds = new Set<number>();

  for (const statement of sourceFile.statements) {
    if (
      isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      isNamedExports(statement.exportClause)
    ) {
      const specifierContext: ExportSpecifierContext = {
        checker,
        includeTypeOnly,
        statementIsTypeOnly: statement.isTypeOnly,
        symbolIds,
      };

      for (const specifier of statement.exportClause.elements)
        addExportSpecifierSymbolId(specifierContext, specifier);
    }

    if (isExportAssignment(statement))
      for (const identifier of collectNodes(statement.expression, isIdentifier))
        addResolvedSymbolId(checker, identifier, symbolIds);
  }

  return symbolIds;
};

export const isIdentifierExported = (
  exportedLocalSymbols: ExportedLocalSymbols,
  declaration: Node,
  identifier: Identifier,
): boolean => {
  if (hasModifier(declaration, SyntaxKind.ExportKeyword)) return true;

  const symbol = exportedLocalSymbols.checker.getSymbolAtLocation(identifier);

  return symbol !== undefined && exportedLocalSymbols.symbolIds.has(symbol.id);
};
