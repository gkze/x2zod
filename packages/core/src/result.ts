import type { Diagnostic } from "./diagnostics";

export type NonEmptyReadonlyArray<TValue> = readonly [TValue, ...TValue[]];

export type Result<TValue> = ResultOk<TValue> | ResultErr;

export type ResultOk<TValue> = Readonly<{
  ok: true;
  value: TValue;
  diagnostics?: readonly Diagnostic[];
}>;

export type ResultErr = Readonly<{ ok: false; diagnostics: NonEmptyReadonlyArray<Diagnostic> }>;

export const ok = <TValue>(
  value: TValue,
  diagnostics: readonly Diagnostic[] = [],
): Result<TValue> =>
  diagnostics.length === 0 ? { ok: true, value } : { diagnostics, ok: true, value };

export const err = (
  diagnostic: Diagnostic,
  ...diagnostics: readonly Diagnostic[]
): Result<never> => ({ diagnostics: [diagnostic, ...diagnostics], ok: false });

export const collectResultDiagnostics = (
  ...results: readonly Result<unknown>[]
): readonly Diagnostic[] => results.flatMap((result) => result.diagnostics ?? []);
