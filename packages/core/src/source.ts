import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  ExportKeyword,
  ImportDeclaration,
  Path,
  PropertyAssignment,
  PropertyName,
  SourceFile,
  Statement,
  TypeAliasDeclaration,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayLiteralExpression,
  createCallExpression,
  createComputedPropertyName,
  createIdentifier,
  createImportClause,
  createImportDeclaration,
  createImportSpecifier,
  createKeywordExpression,
  createNamedImports,
  createNewExpression,
  createNumericLiteral,
  createObjectLiteralExpression,
  createPropertyAccessExpression,
  createQualifiedName,
  createSourceFile as createNativeSourceFile,
  createStringLiteral,
  createToken,
  createTypeAliasDeclaration,
  createTypeQueryNode,
  createTypeReferenceNode,
  createVariableDeclaration,
  createVariableDeclarationList,
  createVariableStatement,
} from "@typescript/native-preview/unstable/ast/factory";

import { resolveZodEmissionTransforms } from "./emission-transform-config";
import type { ZodEmissionTransformInput } from "./emission-transform-config";
import { applyZodEmissionTransforms } from "./emission-transforms";
import { ok } from "./result";
import type { Result } from "./result";
import type { ZodRuntimeProgramId } from "./runtime-program";
import {
  createPropertyAssignment,
  createRemapPropertiesHelper,
  createSourceCodecExpression,
} from "./source-codecs";
import { projectExportDeclarations, resolveZodDeclarationNames } from "./source-declarations";
import type { NamedZodDeclaration } from "./source-declarations";
import {
  createPreservedObjectCodecHelper,
  createZodHelperExpression,
  createZodHelperStatements,
  createZodWrapperExpression,
} from "./source-helpers";
import { createSourceIdentifierAllocator } from "./source-identifiers";
import { createLazyReferenceExpression } from "./source-lazy-references";
import type { SourceArgument, SourceExpression, SourceMethodCall } from "./source-model";
import { resolveZodSourceOutputOptions } from "./source-options";
import type { ZodSourceOutputOptions } from "./source-options";
import {
  createRecursiveDeclarationTypes,
  recursiveReferenceAnnotation,
  recursiveSchemaAnnotation,
} from "./source-recursive-types";
import type { RecursiveDeclarationTypeNames } from "./source-recursive-types";
import {
  createRuntimeGuardExpression,
  createRuntimePredicateHelperStatements,
  createRuntimeProgramStatement,
  resolveRuntimeProgramEmission,
} from "./source-runtime";
import { isTypeScriptIdentifier } from "./typescript-identifiers";
import type { TypeScriptIdentifier as TypeScriptIdentifierValue } from "./typescript-identifiers";
import type { ZodEmissionModule, ZodLiteralValue, ZodSymbol } from "./zod-plan";
import { collectCyclicZodDeclarationPeers } from "./zod-plan-analysis";
import { zodMethodMetadataFor } from "./zod-plan-metadata";
import { validateZodEmissionModule } from "./zod-plan-validation";

export type { TypeScriptIdentifier } from "./typescript-identifiers";
export {
  declarationExportModeSchema,
  resolveZodSourceOutputOptions,
  typeScriptIdentifierSchema,
  zodSourceOutputOptionsSchema,
} from "./source-options";
export type {
  DeclarationExportMode,
  ResolvedZodSourceOutputOptions,
  ZodSourceOutputOptions,
} from "./source-options";

const generatedFileName = "/__x2zod__/x2zod.generated.ts";
const noTokenFlags = 0;
const syntheticSourceText = "";
const prototypeSetterKey = "__proto__";

type SourceExpressionContext = Readonly<{
  lazyReferenceTargets: ReadonlySet<ZodSymbol>;
  recursiveTypeNames: ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames>;
  runtimeProgramNames: ReadonlyMap<ZodRuntimeProgramId, string>;
  schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}>;

export type ZodSourceFile = Readonly<{ sourceFile: SourceFile }>;

const createExportModifier = (): ExportKeyword => createToken(SyntaxKind.ExportKeyword);

const toNativePath = (path: string): Path => path as Path;

const createZodImport = (zodImportPath: string): ImportDeclaration =>
  createImportDeclaration(
    undefined,
    createImportClause(
      undefined,
      undefined,
      createNamedImports([createImportSpecifier(false, undefined, createIdentifier("z"))]),
    ),
    createStringLiteral(zodImportPath, noTokenFlags),
  );

const createPropertyName = (key: string): PropertyName => {
  if (key === prototypeSetterKey)
    return createComputedPropertyName(createStringLiteral(key, noTokenFlags));
  if (isTypeScriptIdentifier(key)) return createIdentifier(key);
  return createStringLiteral(key, noTokenFlags);
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod IR node: ${JSON.stringify(value)}`);
};

const requiredRuntimeProgramName = (
  names: ReadonlyMap<ZodRuntimeProgramId, string>,
  id: ZodRuntimeProgramId,
): string => {
  const name = names.get(id);
  if (name === undefined) throw new Error(`Missing runtime program name for: ${id}`);
  return name;
};

const createLiteralExpression = (value: ZodLiteralValue): Expression => {
  if (typeof value === "string") return createStringLiteral(value, noTokenFlags);
  if (typeof value === "number") return createNumericLiteral(String(value), noTokenFlags);
  if (value === true) return createKeywordExpression(SyntaxKind.TrueKeyword);
  if (value === false) return createKeywordExpression(SyntaxKind.FalseKeyword);
  return createKeywordExpression(SyntaxKind.NullKeyword);
};

const createArgumentExpression = (
  argument: SourceArgument,
  context: SourceExpressionContext,
): Expression => {
  switch (argument.kind) {
    case "array": {
      return createArrayLiteralExpression(
        argument.elements.map((element) => createArgumentExpression(element, context)),
        false,
      );
    }
    case "expression": {
      return createZodExpression(argument.expression, context);
    }
    case "helper": {
      return createZodHelperExpression(argument.request);
    }
    case "literal": {
      return createLiteralExpression(argument.value);
    }
    case "object": {
      return createObjectLiteralExpression(
        argument.properties.map((property) =>
          createPropertyAssignment(
            createPropertyName(property.key),
            createZodExpression(property.expression, context),
          ),
        ),
        false,
      );
    }
    default: {
      return assertNever(argument);
    }
  }
};

const createRegexArgumentExpression = (args: readonly SourceArgument[]): Expression | undefined => {
  const [pattern, flags] = args;
  if (pattern?.kind !== "literal" || typeof pattern.value !== "string") return undefined;
  const flagsValue =
    flags?.kind === "literal" && typeof flags.value === "string" ? flags.value : undefined;
  if (flags !== undefined && flagsValue === undefined) return undefined;
  return createNewExpression(createIdentifier("RegExp"), undefined, [
    createStringLiteral(pattern.value, noTokenFlags),
    ...(flagsValue === undefined || flagsValue.length === 0
      ? []
      : [createStringLiteral(flagsValue, noTokenFlags)]),
  ]);
};

const createRequiredKeysArgumentExpression = (argument: SourceArgument): Expression | undefined => {
  if (argument.kind !== "array") return undefined;

  const properties: PropertyAssignment[] = [];
  for (const element of argument.elements) {
    if (element.kind !== "literal" || typeof element.value !== "string") return undefined;
    properties.push(
      createPropertyAssignment(
        createPropertyName(element.value),
        createKeywordExpression(SyntaxKind.TrueKeyword),
      ),
    );
  }

  return createObjectLiteralExpression(properties, false);
};

const createMethodArgumentExpression = (
  argument: SourceArgument,
  call: SourceMethodCall,
  context: SourceExpressionContext,
): Expression => {
  const printArgument = zodMethodMetadataFor(call.method)?.printArgument;
  if (printArgument === "requiredKeys")
    return (
      createRequiredKeysArgumentExpression(argument) ?? createArgumentExpression(argument, context)
    );

  return createArgumentExpression(argument, context);
};

const createCalledExpression = (
  expression: Expression,
  call: SourceMethodCall,
  context: SourceExpressionContext,
): Expression => {
  const regexArgument =
    zodMethodMetadataFor(call.method)?.printArgument === "regex"
      ? createRegexArgumentExpression(call.args)
      : undefined;
  return createCallExpression(
    createPropertyAccessExpression(
      expression,
      undefined,
      createIdentifier(call.method),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    regexArgument === undefined
      ? call.args.map((argument) => createMethodArgumentExpression(argument, call, context))
      : [regexArgument],
    NodeFlags.None,
  );
};

const createBaseZodExpression = (
  expression: SourceExpression,
  context: SourceExpressionContext,
): Expression => {
  if (expression.kind === "reference") {
    const reference = createIdentifier(
      context.schemaConstNames.get(expression.symbol) ?? expression.symbol,
    );
    const projectedReference =
      expression.view === "schema"
        ? reference
        : createPropertyAccessExpression(
            reference,
            undefined,
            createIdentifier(expression.view === "input" ? "in" : "out"),
            NodeFlags.None,
          );
    return context.lazyReferenceTargets.has(expression.symbol)
      ? createLazyReferenceExpression(
          projectedReference,
          recursiveReferenceAnnotation(expression, context.recursiveTypeNames),
        )
      : projectedReference;
  }

  if (expression.kind === "codec")
    return createSourceCodecExpression({
      createExpression: (nestedExpression) => createZodExpression(nestedExpression, context),
      expression,
    });

  if (expression.kind === "runtime-guard")
    return createRuntimeGuardExpression(
      expression,
      createZodExpression(expression.expression, context),
      requiredRuntimeProgramName(context.runtimeProgramNames, expression.program),
    );

  if (expression.kind === "wrapper")
    return createZodWrapperExpression(
      expression,
      createZodExpression(expression.expression, context),
    );

  return createCallExpression(
    createPropertyAccessExpression(
      createIdentifier("z"),
      undefined,
      createIdentifier(expression.factory),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    expression.args.map((argument) => createArgumentExpression(argument, context)),
    NodeFlags.None,
  );
};

const createZodExpression = (
  expression: SourceExpression,
  context: SourceExpressionContext,
): Expression => {
  let called = createBaseZodExpression(expression, context);
  for (const call of expression.calls) called = createCalledExpression(called, call, context);
  return called;
};

const createSchemaStatementWithNames = (
  namedDeclaration: NamedZodDeclaration,
  expression: SourceExpression,
  context: SourceExpressionContext,
): VariableStatement =>
  createVariableStatement(
    namedDeclaration.exportSchema ? [createExportModifier()] : undefined,
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          createIdentifier(namedDeclaration.schemaConstName),
          undefined,
          recursiveSchemaAnnotation(
            namedDeclaration.declaration.symbol,
            context.recursiveTypeNames,
          ),
          createZodExpression(expression, context),
        ),
      ],
      NodeFlags.Const,
    ),
  );

const createRootTypeStatement = (
  typeName: TypeScriptIdentifierValue,
  schemaConstName: string,
): TypeAliasDeclaration =>
  createTypeAliasDeclaration(
    [createExportModifier()],
    createIdentifier(typeName),
    undefined,
    createTypeReferenceNode(createQualifiedName(createIdentifier("z"), createIdentifier("infer")), [
      createTypeQueryNode(createIdentifier(schemaConstName)),
    ]),
  );

const createSourceFile = (statements: readonly Statement[]): SourceFile =>
  createNativeSourceFile(
    statements,
    createToken(SyntaxKind.EndOfFile),
    syntheticSourceText,
    generatedFileName,
    toNativePath(generatedFileName),
  );

export const buildZodSourceFile = (
  module: ZodEmissionModule,
  options: ZodSourceOutputOptions,
  transforms: readonly ZodEmissionTransformInput[] = [],
): Result<ZodSourceFile> => {
  const validModule = validateZodEmissionModule(module);
  if (!validModule.ok) return validModule;

  const resolvedTransforms = resolveZodEmissionTransforms(transforms);
  if (!resolvedTransforms.ok) return resolvedTransforms;

  const output = resolveZodSourceOutputOptions(options);
  if (!output.ok) return output;
  const exported = projectExportDeclarations(validModule.value, output.value.declarationExportMode);
  const sourceModule = applyZodEmissionTransforms(exported.module, resolvedTransforms.value);
  if (!sourceModule.ok) return sourceModule;

  const identifierAllocation = createSourceIdentifierAllocator(sourceModule.value);
  const namedModule = resolveZodDeclarationNames(exported.module, {
    ...output.value,
    exportOrigins: exported.exportOrigins,
    identifierAllocator: identifierAllocation.allocator,
  });
  if (!namedModule.ok) return namedModule;

  const runtimeProgramEmission = resolveRuntimeProgramEmission(
    exported.module,
    identifierAllocation.allocator,
  );
  const cyclicPeers = collectCyclicZodDeclarationPeers(exported.module);
  const cyclicSymbols = namedModule.value.declarations
    .map((declaration) => declaration.declaration.symbol)
    .filter((symbol) => cyclicPeers.has(symbol));
  const recursiveTypes = createRecursiveDeclarationTypes({
    allocator: identifierAllocation.allocator,
    cyclicSymbols,
    module: sourceModule.value,
    schemaConstNames: namedModule.value.schemaConstNames,
  });
  const sourceExpressionContext: SourceExpressionContext = {
    lazyReferenceTargets: new Set<ZodSymbol>(),
    recursiveTypeNames: recursiveTypes.names,
    runtimeProgramNames: runtimeProgramEmission.names,
    schemaConstNames: namedModule.value.schemaConstNames,
  };

  const sourceDeclarations = new Map(
    sourceModule.value.declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const expressionFor = (symbol: ZodSymbol): SourceExpression => {
    const declaration = sourceDeclarations.get(symbol);
    if (declaration === undefined)
      throw new Error(`Missing transformed source declaration for symbol: ${symbol}`);
    return declaration.expression;
  };
  return ok({
    sourceFile: createSourceFile([
      createZodImport(output.value.zodImportPath),
      ...createZodHelperStatements(identifierAllocation.helperNames),
      ...(identifierAllocation.needsPreservedObjectCodec
        ? [createPreservedObjectCodecHelper()]
        : []),
      ...createRuntimePredicateHelperStatements(identifierAllocation.runtimeGuardParseModes),
      ...(identifierAllocation.needsRemapHelper ? [createRemapPropertiesHelper()] : []),
      ...runtimeProgramEmission.programs.map((program) =>
        createRuntimeProgramStatement(
          requiredRuntimeProgramName(runtimeProgramEmission.names, program.id),
          program,
        ),
      ),
      ...recursiveTypes.statements,
      ...namedModule.value.declarations.map((declaration) =>
        createSchemaStatementWithNames(declaration, expressionFor(declaration.declaration.symbol), {
          ...sourceExpressionContext,
          lazyReferenceTargets:
            cyclicPeers.get(declaration.declaration.symbol) ??
            sourceExpressionContext.lazyReferenceTargets,
        }),
      ),
      createRootTypeStatement(output.value.typeName, namedModule.value.rootSchemaConstName),
    ]),
  });
};
