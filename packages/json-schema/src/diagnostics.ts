import { createDiagnostic, err, ok } from "@x2zod/core";
import type {
  Diagnostic,
  DiagnosticLocation,
  JsonPointer,
  Result,
  SourceLocationMap,
} from "@x2zod/core";

export type JsonSchemaDiagnosticInput = Readonly<{
  code: string;
  message: string;
  pointer: JsonPointer;
  severity?: Diagnostic["severity"] | undefined;
}>;

export type JsonSchemaDiagnosticSink = Readonly<{
  addDiagnostic: (input: JsonSchemaDiagnosticInput) => void;
}>;

export const jsonSchemaDiagnosticLocation = (
  pointer: JsonPointer,
  locations?: SourceLocationMap,
): DiagnosticLocation => {
  const sourceSpan = locations?.get(pointer);
  return sourceSpan === undefined ? { pointer } : { pointer, sourceSpan };
};

export const createJsonSchemaDiagnostic = (
  input: JsonSchemaDiagnosticInput,
  locations?: SourceLocationMap,
): Diagnostic =>
  createDiagnostic({
    code: input.code,
    location: jsonSchemaDiagnosticLocation(input.pointer, locations),
    message: input.message,
    severity: input.severity ?? "error",
  });

export const addJsonSchemaDiagnostic = (
  diagnostics: Diagnostic[],
  input: JsonSchemaDiagnosticInput,
  locations?: SourceLocationMap,
): void => {
  diagnostics.push(createJsonSchemaDiagnostic(input, locations));
};

export const resultFromJsonSchemaDiagnostics = <TValue>(
  value: TValue,
  diagnostics: readonly Diagnostic[],
): Result<TValue> => {
  const errors: Diagnostic[] = [];
  for (const diagnostic of diagnostics)
    if (diagnostic.severity === "error") errors.push(diagnostic);
  const [firstError, ...remainingErrors] = errors;
  return firstError === undefined ? ok(value, diagnostics) : err(firstError, ...remainingErrors);
};
