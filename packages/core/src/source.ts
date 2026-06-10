import { NodeFlags, SyntaxKind } from "@typescript/native-preview/ast";
import type {
  Expression,
  ImportDeclaration,
  ModifierLike,
  Path,
  PropertyAssignment,
  PropertyName,
  SourceFile,
  Statement,
  TypeAliasDeclaration,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/ast";
import {
  createArrayLiteralExpression,
  createCallExpression,
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
  createPropertyAssignment,
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
} from "@typescript/native-preview/ast/factory";
import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import { resolveZodDeclarationNames } from "./source-declarations";
import type { NamedZodDeclaration } from "./source-declarations";
import {
  isTypeScriptIdentifier,
  typeScriptIdentifierSchema as typeScriptIdentifierSchemaValue,
} from "./typescript-identifiers";
import type { TypeScriptIdentifier as TypeScriptIdentifierValue } from "./typescript-identifiers";
import type {
  ZodArgument,
  ZodEmissionModule,
  ZodExpression,
  ZodLiteralValue,
  ZodMethodCall,
  ZodSymbol,
} from "./zod-plan";
import { zodMethodMetadataFor } from "./zod-plan-metadata";
import { validateZodEmissionModule } from "./zod-plan-validation";
export type { TypeScriptIdentifier } from "./typescript-identifiers";

const defaultZodImportPath = "zod/v4";
const generatedFileName = "/__x2zod__/x2zod.generated.ts";
const nonEmptyStringLength = 1;
const noTokenFlags = 0;
const syntheticSourceText = "";
const typeNameField = "typeName";

export type DeclarationExportMode = "all" | "root";
export type ZodSourceOutputOptions = Readonly<{
  typeName: string;
  zodImportPath?: string | undefined;
  declarationExportMode?: DeclarationExportMode | undefined;
}>;
export type ResolvedZodSourceOutputOptions = Readonly<{
  typeName: TypeScriptIdentifierValue;
  zodImportPath: string;
  declarationExportMode: DeclarationExportMode;
}>;
export type ZodSourceFile = Readonly<{ sourceFile: SourceFile }>;

const declarationExportModeSchemaValue: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  z.enum(["all", "root"]);
export const declarationExportModeSchema: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  declarationExportModeSchemaValue;

export const typeScriptIdentifierSchema: z.ZodType<TypeScriptIdentifierValue, string> =
  typeScriptIdentifierSchemaValue;

const zodSourceOutputOptionsSchemaValue: z.ZodType<
  ResolvedZodSourceOutputOptions,
  ZodSourceOutputOptions
> = z
  .strictObject({
    typeName: typeScriptIdentifierSchemaValue,
    zodImportPath: z.string().min(nonEmptyStringLength).default(defaultZodImportPath),
    declarationExportMode: declarationExportModeSchemaValue.default("root"),
  })
  .readonly();
export const zodSourceOutputOptionsSchema: z.ZodType<
  ResolvedZodSourceOutputOptions,
  ZodSourceOutputOptions
> = zodSourceOutputOptionsSchemaValue;

const hasIssueAtPath = (error: z.ZodError, pathHead: PropertyKey): boolean =>
  error.issues.some((issue) => issue.path[0] === pathHead);

export const resolveZodSourceOutputOptions = (
  options: ZodSourceOutputOptions,
): Result<ResolvedZodSourceOutputOptions> => {
  const parsed = zodSourceOutputOptionsSchemaValue.safeParse(options);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: hasIssueAtPath(parsed.error, typeNameField)
            ? "invalid_output_type_name"
            : "invalid_output_options",
          message: `Output options are invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};

const createModifierToken = (kind: SyntaxKind.ExportKeyword): ModifierLike =>
  createToken(kind) as ModifierLike;

const toNativePath = (path: string): Path => path as Path;

const createExportModifier = (): ModifierLike => createModifierToken(SyntaxKind.ExportKeyword);

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

const createPropertyName = (key: string): PropertyName =>
  isTypeScriptIdentifier(key) ? createIdentifier(key) : createStringLiteral(key, noTokenFlags);

// Native preview currently types property-assignment annotations as required.
// Ordinary object literal properties intentionally omit that node.
const omittedTypeNode = (): TypeNode => undefined as unknown as TypeNode;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod IR node: ${JSON.stringify(value)}`);
};

const createLiteralExpression = (value: ZodLiteralValue): Expression => {
  if (typeof value === "string") return createStringLiteral(value, noTokenFlags);
  if (typeof value === "number") return createNumericLiteral(String(value), noTokenFlags);
  if (value === true) return createKeywordExpression(SyntaxKind.TrueKeyword);
  if (value === false) return createKeywordExpression(SyntaxKind.FalseKeyword);
  return createKeywordExpression(SyntaxKind.NullKeyword);
};

const createArgumentExpression = (
  argument: ZodArgument,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): Expression => {
  switch (argument.kind) {
    case "array": {
      return createArrayLiteralExpression(
        argument.elements.map((element) => createArgumentExpression(element, schemaConstNames)),
        false,
      );
    }
    case "expression": {
      return createZodExpression(argument.expression, schemaConstNames);
    }
    case "literal": {
      return createLiteralExpression(argument.value);
    }
    case "object": {
      return createObjectLiteralExpression(
        argument.properties.map((property) =>
          createPropertyAssignment(
            undefined,
            createPropertyName(property.key),
            undefined,
            omittedTypeNode(),
            createZodExpression(property.expression, schemaConstNames),
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

const createRegexArgumentExpression = (argument: ZodArgument): Expression | undefined => {
  if (argument.kind !== "literal" || typeof argument.value !== "string") return undefined;
  return createNewExpression(createIdentifier("RegExp"), undefined, [
    createStringLiteral(argument.value, noTokenFlags),
  ]);
};

const createRequiredKeysArgumentExpression = (argument: ZodArgument): Expression | undefined => {
  if (argument.kind !== "array") return undefined;

  const properties: PropertyAssignment[] = [];
  for (const element of argument.elements) {
    if (element.kind !== "literal" || typeof element.value !== "string") return undefined;
    properties.push(
      createPropertyAssignment(
        undefined,
        createPropertyName(element.value),
        undefined,
        omittedTypeNode(),
        createKeywordExpression(SyntaxKind.TrueKeyword),
      ),
    );
  }

  return createObjectLiteralExpression(properties, false);
};

const createMethodArgumentExpression = (
  argument: ZodArgument,
  call: ZodMethodCall,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): Expression => {
  const printArgument = zodMethodMetadataFor(call.method)?.printArgument;
  if (printArgument === "regex")
    return (
      createRegexArgumentExpression(argument) ??
      createArgumentExpression(argument, schemaConstNames)
    );
  if (printArgument === "requiredKeys")
    return (
      createRequiredKeysArgumentExpression(argument) ??
      createArgumentExpression(argument, schemaConstNames)
    );

  return createArgumentExpression(argument, schemaConstNames);
};

const createCalledExpression = (
  expression: Expression,
  call: ZodMethodCall,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): Expression =>
  createCallExpression(
    createPropertyAccessExpression(
      expression,
      undefined,
      createIdentifier(call.method),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    call.args.map((argument) => createMethodArgumentExpression(argument, call, schemaConstNames)),
    NodeFlags.None,
  );

const createBaseZodExpression = (
  expression: ZodExpression,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): Expression => {
  if (expression.kind === "reference")
    return createIdentifier(schemaConstNames.get(expression.symbol) ?? expression.symbol);

  return createCallExpression(
    createPropertyAccessExpression(
      createIdentifier("z"),
      undefined,
      createIdentifier(expression.factory),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    expression.args.map((argument) => createArgumentExpression(argument, schemaConstNames)),
    NodeFlags.None,
  );
};

const createZodExpression = (
  expression: ZodExpression,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): Expression => {
  let called = createBaseZodExpression(expression, schemaConstNames);
  for (const call of expression.calls)
    called = createCalledExpression(called, call, schemaConstNames);
  return called;
};

const createSchemaStatementWithNames = (
  namedDeclaration: NamedZodDeclaration,
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
): VariableStatement =>
  createVariableStatement(
    namedDeclaration.exportSchema ? [createExportModifier()] : undefined,
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          createIdentifier(namedDeclaration.schemaConstName),
          undefined,
          undefined,
          createZodExpression(namedDeclaration.declaration.expression, schemaConstNames),
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
): Result<ZodSourceFile> => {
  const validModule = validateZodEmissionModule(module);
  if (!validModule.ok) return validModule;

  const output = resolveZodSourceOutputOptions(options);
  if (!output.ok) return output;

  const namedModule = resolveZodDeclarationNames(validModule.value, output.value);
  if (!namedModule.ok) return namedModule;

  return ok({
    sourceFile: createSourceFile([
      createZodImport(output.value.zodImportPath),
      ...namedModule.value.declarations.map((declaration) =>
        createSchemaStatementWithNames(declaration, namedModule.value.schemaConstNames),
      ),
      createRootTypeStatement(output.value.typeName, namedModule.value.rootSchemaConstName),
    ]),
  });
};
