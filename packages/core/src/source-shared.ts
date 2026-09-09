import {
  isIdentifier,
  isTypeAliasDeclaration,
  isVariableStatement,
  SyntaxKind,
} from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  ImportDeclaration,
  Statement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createIdentifier,
  createImportClause,
  createImportDeclaration,
  createImportSpecifier,
  createNamedImports,
  createNamespaceImport,
  createStringLiteral,
  createToken,
  createTypeQueryNode,
} from "@typescript/native-preview/unstable/ast/factory";

import type { ZodRuntimeProgram } from "./runtime-program";
import { createSourceArrowParameter, createSourceFunctionCall } from "./source-ast";
import { zodHelperDependencyIdentifierNames } from "./source-helpers";
import type { TypeScriptIdentifierAllocator } from "./typescript-identifiers";

export const createSharedImport = (
  specifier: string,
  bindings: readonly Readonly<{ imported: string; local: string }>[],
): ImportDeclaration =>
  createImportDeclaration(
    undefined,
    createImportClause(
      undefined,
      undefined,
      createNamedImports(
        bindings.map(({ imported, local }) =>
          createImportSpecifier(
            false,
            imported === local ? undefined : createIdentifier(imported),
            createIdentifier(local),
          ),
        ),
      ),
    ),
    createStringLiteral(specifier, 0),
  );

export const helperStatementNames = (statements: readonly Statement[]): readonly string[] =>
  statements.flatMap((statement) => {
    if (isTypeAliasDeclaration(statement)) return [];
    if (!isVariableStatement(statement))
      throw new Error("Runtime helper must be a variable statement.");
    return statement.declarationList.declarations.map((declaration) => {
      if (!isIdentifier(declaration.name))
        throw new Error("Runtime helper must have an identifier name.");
      return declaration.name.text;
    });
  });

export const sharedHelperStatements = (statements: readonly Statement[]): readonly Statement[] => {
  // Dependencies of imported helpers live in the runtime package, not in the consumer module.
  const names = helperStatementNames(statements).filter(
    (name) => !zodHelperDependencyIdentifierNames.has(name),
  );
  return names.length === 0
    ? []
    : [
        createSharedImport(
          "@x2zod/runtime",
          names.map((name) => ({ imported: name, local: name })),
        ),
      ];
};

export const sharedRuntimePrograms = (
  programs: readonly ZodRuntimeProgram[],
  allocator: TypeScriptIdentifierAllocator,
): Readonly<{ imports: readonly ImportDeclaration[]; programs: readonly ZodRuntimeProgram[] }> => {
  const namespaces = new Map<string, string>();
  const imports: ImportDeclaration[] = [];
  const namespaceFor = (specifier: string): string => {
    const existing = namespaces.get(specifier);
    if (existing !== undefined) return existing;
    const name = allocator.allocate("x2zodSharedRuntime");
    namespaces.set(specifier, name);
    imports.push(
      createImportDeclaration(
        undefined,
        createImportClause(undefined, undefined, createNamespaceImport(createIdentifier(name))),
        createStringLiteral(specifier, 0),
      ),
    );
    return name;
  };
  const expressionFor = (program: ZodRuntimeProgram): Expression => {
    if (program.shared === undefined) return program.expression;
    const bindings = Object.entries(program.shared.imports).map(([local, specifier]) => ({
      local,
      namespace: namespaceFor(specifier),
    }));
    // Bind plugin-local names inside an initializer so imports cannot capture declarations.
    return createSourceFunctionCall(
      createArrowFunction(
        undefined,
        undefined,
        bindings.map(({ local, namespace }) =>
          createSourceArrowParameter(local, createTypeQueryNode(createIdentifier(namespace))),
        ),
        undefined,
        createToken(SyntaxKind.EqualsGreaterThanToken),
        program.shared.expression,
      ),
      bindings.map(({ namespace }) => createIdentifier(namespace)),
    );
  };
  const resolved = programs.map((program) => ({ ...program, expression: expressionFor(program) }));
  return { imports, programs: resolved };
};
