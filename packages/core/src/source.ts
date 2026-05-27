import { NodeFlags, SyntaxKind } from "@typescript/native-preview/ast";
import type {
  Expression,
  ImportDeclaration,
  ModifierLike,
  Path,
  SourceFile,
  Statement,
  TypeAliasDeclaration,
  VariableStatement,
} from "@typescript/native-preview/ast";
import {
  createCallExpression,
  createIdentifier,
  createImportClause,
  createImportDeclaration,
  createImportSpecifier,
  createNamedImports,
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
} from "@typescript/native-preview/ast/factory";
import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { ZodEmissionModule, ZodExpression } from "./zod-plan";

const defaultZodImportPath = "zod/v4";
const generatedFileName = "x2zod.generated.ts";
const identifierPattern = /^[A-Za-z_$][\w$]*$/u;
const nonEmptyStringLength = 1;
const noTokenFlags = 0;
const typeNameField = "typeName";

export type DeclarationExportMode = "all" | "root";
export type TypeScriptIdentifier = string & z.$brand<"TypeScriptIdentifier">;
export type ZodSourceOutputOptions = Readonly<{
  typeName: string;
  zodImportPath?: string | undefined;
  declarationExportMode?: DeclarationExportMode | undefined;
}>;
export type ResolvedZodSourceOutputOptions = Readonly<{
  typeName: TypeScriptIdentifier;
  zodImportPath: string;
  declarationExportMode: DeclarationExportMode;
}>;

const declarationExportModeSchemaValue: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  z.enum(["all", "root"]);
export const declarationExportModeSchema: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  declarationExportModeSchemaValue;

const typeScriptIdentifierSchemaValue: z.ZodType<TypeScriptIdentifier, string> = z
  .string()
  .regex(identifierPattern)
  .transform((value): TypeScriptIdentifier => value as TypeScriptIdentifier);
export const typeScriptIdentifierSchema: z.ZodType<TypeScriptIdentifier, string> =
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

export type ZodSourceFile = Readonly<{ sourceFile: SourceFile }>;

const escapeStringLiteral = (value: string): string => JSON.stringify(value);

const schemaConstNameForType = (typeName: TypeScriptIdentifier): string =>
  `${typeName.slice(0, 1).toLowerCase()}${typeName.slice(1)}Schema`;

const renderZodExpression = (expression: ZodExpression): string => `z.${expression.factory}()`;

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

const createZodExpression = (expression: ZodExpression): Expression =>
  createCallExpression(
    createPropertyAccessExpression(
      createIdentifier("z"),
      undefined,
      createIdentifier(expression.factory),
      NodeFlags.None,
    ),
    undefined,
    undefined,
    [],
    NodeFlags.None,
  );

const renderSourceText = (
  module: ZodEmissionModule,
  options: ResolvedZodSourceOutputOptions,
  schemaConstName: string,
): string =>
  [
    `import { z } from ${escapeStringLiteral(options.zodImportPath)};`,
    "",
    `export const ${schemaConstName} = ${renderZodExpression(module.root)};`,
    "",
    `export type ${options.typeName} = z.infer<typeof ${schemaConstName}>;`,
    "",
  ].join("\n");

// Native preview exposes branded internal node types that its factories cannot fully infer yet.
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

const createRootSchemaStatement = (
  schemaConstName: string,
  expression: ZodExpression,
): VariableStatement =>
  createVariableStatement(
    [createExportModifier()],
    createVariableDeclarationList(
      [
        createVariableDeclaration(
          createIdentifier(schemaConstName),
          undefined,
          undefined,
          createZodExpression(expression),
        ),
      ],
      NodeFlags.Const,
    ),
  );

const createRootTypeStatement = (typeName: string, schemaConstName: string): TypeAliasDeclaration =>
  createTypeAliasDeclaration(
    [createExportModifier()],
    createIdentifier(typeName),
    undefined,
    createTypeReferenceNode(createQualifiedName(createIdentifier("z"), createIdentifier("infer")), [
      createTypeQueryNode(createIdentifier(schemaConstName)),
    ]),
  );

const createSourceFile = (statements: readonly Statement[], sourceText: string): SourceFile =>
  createNativeSourceFile(
    statements,
    createToken(SyntaxKind.EndOfFile),
    sourceText,
    generatedFileName,
    toNativePath(generatedFileName),
  );

export const buildZodSourceFile = (
  module: ZodEmissionModule,
  options: ZodSourceOutputOptions,
): Result<ZodSourceFile> => {
  const output = resolveZodSourceOutputOptions(options);
  if (!output.ok) return output;

  const schemaConstName = schemaConstNameForType(output.value.typeName);
  const sourceText = renderSourceText(module, output.value, schemaConstName);

  return ok({
    sourceFile: createSourceFile(
      [
        createZodImport(output.value.zodImportPath),
        createRootSchemaStatement(schemaConstName, module.root),
        createRootTypeStatement(output.value.typeName, schemaConstName),
      ],
      sourceText,
    ),
  });
};
