import type { ZodRuntimeProgram, ZodRuntimeProgramInput } from "./runtime-program";
import type { ZodExpression, ZodExpressionInput, ZodSymbol } from "./zod-plan";

/** A nonempty, source-adapter-owned label that core preserves but does not interpret. */
export type ZodDeclarationNameHintProvenance = string;
export type ZodDeclarationNameHint = Readonly<{
  value: string;
  provenance: ZodDeclarationNameHintProvenance;
}>;
export type ZodDeclarationNameHintInput = Readonly<{
  value: string;
  provenance?: ZodDeclarationNameHintProvenance | undefined;
}>;
export type ZodDeclaration = Readonly<{
  symbol: ZodSymbol;
  expression: ZodExpression;
  nameHints: readonly ZodDeclarationNameHint[];
}>;
export type ZodDeclarationInput = Readonly<{
  symbol: string;
  expression: ZodExpressionInput;
  nameHints?: readonly ZodDeclarationNameHintInput[] | undefined;
}>;
export type ZodEmissionModule = Readonly<{
  root: ZodSymbol;
  declarations: readonly ZodDeclaration[];
  runtimePrograms: readonly ZodRuntimeProgram[];
}>;
export type ZodEmissionModuleInput = Readonly<{
  root: string;
  declarations: readonly ZodDeclarationInput[];
  runtimePrograms?: readonly ZodRuntimeProgramInput[] | undefined;
}>;

export const zodDeclarationNameHint = (
  value: string,
  provenance: ZodDeclarationNameHintProvenance = "explicit",
): ZodDeclarationNameHint => ({ provenance, value });

export const zodDeclaration = (
  symbol: ZodSymbol,
  expression: ZodExpression,
  nameHints: readonly ZodDeclarationNameHint[] = [],
): ZodDeclaration => ({ expression, nameHints, symbol });

export const zodModule = (
  root: ZodSymbol,
  declarations: readonly ZodDeclaration[],
  runtimePrograms: readonly ZodRuntimeProgram[] = [],
): ZodEmissionModule => ({ declarations, root, runtimePrograms });
