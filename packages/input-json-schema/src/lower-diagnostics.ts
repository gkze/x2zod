import { addJsonSchemaDiagnostic } from "./diagnostics";
import type { JsonSchemaDiagnosticInput, JsonSchemaDiagnosticSink } from "./diagnostics";
import type { LoweringContext } from "./lower-types";

export const addLoweringDiagnostic = (
  context: LoweringContext,
  input: JsonSchemaDiagnosticInput,
): void => {
  addJsonSchemaDiagnostic(context.diagnostics, input, context.locations);
};

export const loweringDiagnosticSink = (context: LoweringContext): JsonSchemaDiagnosticSink => ({
  addDiagnostic: (input): void => {
    addLoweringDiagnostic(context, input);
  },
});
