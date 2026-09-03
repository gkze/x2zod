import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import { typeScriptIdentifierSchema as typeScriptIdentifierSchemaValue } from "./typescript-identifiers";
import type { TypeScriptIdentifier } from "./typescript-identifiers";
import { zodSymbolSchema } from "./zod-plan";

const defaultZodImportPath = "zod/v4";
const nonEmptyStringLength = 1;
const typeNameField = "typeName";

export type DeclarationExportMode = "all" | "root";
export type ZodSourceOutputOptions = Readonly<{
  declarationNameOverrides?: Readonly<Record<string, string>> | undefined;
  typeName: string;
  zodImportPath?: string | undefined;
  declarationExportMode?: DeclarationExportMode | undefined;
}>;
export type ResolvedZodSourceOutputOptions = Readonly<{
  declarationNameOverrides: Readonly<Record<string, TypeScriptIdentifier>>;
  typeName: TypeScriptIdentifier;
  zodImportPath: string;
  declarationExportMode: DeclarationExportMode;
}>;

const declarationExportModeSchemaValue: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  z.enum(["all", "root"]);
export const declarationExportModeSchema: z.ZodType<DeclarationExportMode, DeclarationExportMode> =
  declarationExportModeSchemaValue;

export const typeScriptIdentifierSchema: z.ZodType<TypeScriptIdentifier, string> =
  typeScriptIdentifierSchemaValue;

const zodSourceOutputOptionsSchemaValue: z.ZodType<
  ResolvedZodSourceOutputOptions,
  ZodSourceOutputOptions
> = z
  .strictObject({
    declarationNameOverrides: z
      .record(zodSymbolSchema, typeScriptIdentifierSchemaValue)
      .default({})
      .readonly(),
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
