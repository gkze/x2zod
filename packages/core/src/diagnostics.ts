import { z } from "zod/v4";

const firstSourcePosition = 1;
const nonEmptyStringLength = 1;
const jsonPointerPattern = /^(?:\/(?:[^~/]|~0|~1)*)*$/u;
const pluginDiagnosticCodePattern = /^[a-z][a-z0-9-]*(?:[./][a-z][a-z0-9_-]*)+$/u;

export type JsonPointer = string & z.$brand<"JsonPointer">;
export type DiagnosticSeverity = "error" | "warning";
export type CoreDiagnosticCode =
  | "ambiguous_schema"
  | "dialect_conflict"
  | "emitter_failure"
  | "invalid_diagnostic_code"
  | "invalid_input_document"
  | "invalid_json_pointer"
  | "invalid_output_options"
  | "invalid_output_type_name"
  | "invalid_plugin_options"
  | "invalid_schema_document"
  | "invalid_zod_emission_module"
  | "plugin_exception"
  | "unrepresentable_schema_combination"
  | "unresolved_reference"
  | "unsupported_dialect"
  | "unsupported_keyword"
  | "unsupported_vocabulary"
  | "unknown_keyword";
export type PluginDiagnosticCode = string & z.$brand<"PluginDiagnosticCode">;
export type DiagnosticCode = CoreDiagnosticCode | PluginDiagnosticCode;
export type SourcePosition = Readonly<{ line: number; column: number }>;
export type SourcePositionInput = SourcePosition;
export type SourceSpan = Readonly<{ file: string; start: SourcePosition; end?: SourcePosition }>;
export type SourceSpanInput = SourceSpan;
export type DiagnosticLocation = Readonly<{ pointer: JsonPointer; sourceSpan?: SourceSpan }>;
export type DiagnosticLocationInput = Readonly<{ pointer: string; sourceSpan?: SourceSpanInput }>;
export type Diagnostic = Readonly<{
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  location?: DiagnosticLocation;
}>;
export type CreateDiagnosticInput = Readonly<{
  code: string;
  severity?: DiagnosticSeverity | undefined;
  message: string;
  location?: DiagnosticLocationInput;
}>;

const jsonPointerSchemaValue: z.ZodType<JsonPointer, string> = z
  .string()
  .regex(jsonPointerPattern)
  .transform((value): JsonPointer => value as JsonPointer);
export const jsonPointerSchema: z.ZodType<JsonPointer, string> = jsonPointerSchemaValue;

const diagnosticSeveritySchemaValue: z.ZodType<DiagnosticSeverity, DiagnosticSeverity> = z.enum([
  "error",
  "warning",
]);
export const diagnosticSeveritySchema: z.ZodType<DiagnosticSeverity, DiagnosticSeverity> =
  diagnosticSeveritySchemaValue;

const coreDiagnosticCodeSchemaValue: z.ZodType<CoreDiagnosticCode, CoreDiagnosticCode> = z.enum([
  "ambiguous_schema",
  "dialect_conflict",
  "emitter_failure",
  "invalid_diagnostic_code",
  "invalid_input_document",
  "invalid_json_pointer",
  "invalid_output_options",
  "invalid_output_type_name",
  "invalid_plugin_options",
  "invalid_schema_document",
  "invalid_zod_emission_module",
  "plugin_exception",
  "unrepresentable_schema_combination",
  "unresolved_reference",
  "unsupported_dialect",
  "unsupported_keyword",
  "unsupported_vocabulary",
  "unknown_keyword",
]);
export const coreDiagnosticCodeSchema: z.ZodType<CoreDiagnosticCode, CoreDiagnosticCode> =
  coreDiagnosticCodeSchemaValue;

const pluginDiagnosticCodeSchemaValue: z.ZodType<PluginDiagnosticCode, string> = z
  .string()
  .regex(pluginDiagnosticCodePattern)
  .transform((value): PluginDiagnosticCode => value as PluginDiagnosticCode);
export const pluginDiagnosticCodeSchema: z.ZodType<PluginDiagnosticCode, string> =
  pluginDiagnosticCodeSchemaValue;

const diagnosticCodeSchemaValue: z.ZodType<DiagnosticCode, string> = z.union([
  coreDiagnosticCodeSchemaValue,
  pluginDiagnosticCodeSchemaValue,
]);
export const diagnosticCodeSchema: z.ZodType<DiagnosticCode, string> = diagnosticCodeSchemaValue;

const sourcePositionSchemaValue: z.ZodType<SourcePosition, SourcePositionInput> = z
  .strictObject({
    line: z.int().min(firstSourcePosition),
    column: z.int().min(firstSourcePosition),
  })
  .readonly();
export const sourcePositionSchema: z.ZodType<SourcePosition, SourcePositionInput> =
  sourcePositionSchemaValue;

const sourceSpanSchemaValue: z.ZodType<SourceSpan, SourceSpanInput> = z
  .strictObject({
    file: z.string().min(nonEmptyStringLength),
    start: sourcePositionSchemaValue,
    end: sourcePositionSchemaValue.exactOptional(),
  })
  .readonly();
export const sourceSpanSchema: z.ZodType<SourceSpan, SourceSpanInput> = sourceSpanSchemaValue;

const diagnosticLocationSchemaValue: z.ZodType<DiagnosticLocation, DiagnosticLocationInput> = z
  .strictObject({
    pointer: jsonPointerSchemaValue,
    sourceSpan: sourceSpanSchemaValue.exactOptional(),
  })
  .readonly();
export const diagnosticLocationSchema: z.ZodType<DiagnosticLocation, DiagnosticLocationInput> =
  diagnosticLocationSchemaValue;

const diagnosticSchemaValue: z.ZodType<Diagnostic, CreateDiagnosticInput> = z
  .strictObject({
    code: diagnosticCodeSchemaValue,
    severity: diagnosticSeveritySchemaValue.default("error"),
    message: z.string().min(nonEmptyStringLength),
    location: diagnosticLocationSchemaValue.exactOptional(),
  })
  .readonly();
export const diagnosticSchema: z.ZodType<Diagnostic, CreateDiagnosticInput> = diagnosticSchemaValue;

const formatIssuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map(String).join(".");

export const formatZodError = (error: z.ZodError): string =>
  error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join("; ");

export const createDiagnostic = (input: CreateDiagnosticInput): Diagnostic =>
  diagnosticSchemaValue.parse(input);
