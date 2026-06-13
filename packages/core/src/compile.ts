import type { SourceFile } from "@typescript/native-preview/unstable/ast";

import { createDiagnostic, formatZodError } from "./diagnostics";
import type { InputDocumentInput, InputPlugin, PluginOptionsSchema, PreparedInput } from "./input";
import { parseInputDocument } from "./input";
import { collectResultDiagnostics, err, ok } from "./result";
import type { Result } from "./result";
import { buildZodSourceFile } from "./source";
import type { ZodSourceOutputOptions } from "./source";
import { parseZodEmissionModule } from "./zod-plan";
import type { ZodEmissionModuleInput } from "./zod-plan";

export type CompileToZodSourceRequest<
  TPreparedInput,
  TPluginOptions,
  TPluginOptionsInput = TPluginOptions,
  TPluginKind extends string = string,
> = Readonly<{
  document: InputDocumentInput;
  plugin: InputPlugin<TPreparedInput, TPluginOptions, TPluginOptionsInput, TPluginKind>;
  pluginOptions: TPluginOptionsInput;
  output: ZodSourceOutputOptions;
}>;

export type CompileToZodSourceResult = Result<Readonly<{ sourceFile: SourceFile }>>;

type PluginStep = "lower" | "prepare";

type PluginStepRequest<TArgs extends readonly unknown[], TValue> = Readonly<{
  pluginKind: string;
  step: PluginStep;
  run: (...args: TArgs) => Promise<Result<TValue>>;
  args: TArgs;
}>;

const unknownErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown plugin exception.";

const runPluginStep = async <TArgs extends readonly unknown[], TValue>({
  args,
  pluginKind,
  run,
  step,
}: PluginStepRequest<TArgs, TValue>): Promise<Result<TValue>> => {
  try {
    return await run(...args);
  } catch (error) {
    return err(
      createDiagnostic({
        code: "plugin_exception",
        message: `Plugin ${pluginKind} threw during ${step}: ${unknownErrorMessage(error)}`,
      }),
    );
  }
};

const parsePluginOptions = <TPluginOptions, TPluginOptionsInput>(
  pluginKind: string,
  schema: PluginOptionsSchema<TPluginOptions, TPluginOptionsInput>,
  options: TPluginOptionsInput,
): Result<TPluginOptions> => {
  const parsed = schema.safeParse(options);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: "invalid_plugin_options",
          message: `Plugin ${pluginKind} options are invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};

const mergeSuccess = (
  sourceFile: SourceFile,
  ...results: readonly Result<unknown>[]
): CompileToZodSourceResult => ok({ sourceFile }, collectResultDiagnostics(...results));

export const compileToZodSource = async <
  TPreparedInput,
  TPluginOptions,
  TPluginOptionsInput = TPluginOptions,
>({
  document,
  output,
  plugin,
  pluginOptions,
}: CompileToZodSourceRequest<
  TPreparedInput,
  TPluginOptions,
  TPluginOptionsInput
>): Promise<CompileToZodSourceResult> => {
  const parsedDocument = parseInputDocument(document);
  if (!parsedDocument.ok) return parsedDocument;

  const parsedOptions = parsePluginOptions(plugin.kind, plugin.optionsSchema, pluginOptions);
  if (!parsedOptions.ok) return parsedOptions;

  const prepared = await runPluginStep({
    args: [parsedDocument.value, parsedOptions.value],
    pluginKind: plugin.kind,
    run: plugin.prepare,
    step: "prepare",
  });
  if (!prepared.ok) return prepared;

  const loweredInput = await runPluginStep<
    [PreparedInput<TPreparedInput>, TPluginOptions],
    ZodEmissionModuleInput
  >({
    args: [prepared.value, parsedOptions.value],
    pluginKind: plugin.kind,
    run: plugin.lower,
    step: "lower",
  });
  if (!loweredInput.ok) return loweredInput;

  const lowered = parseZodEmissionModule(loweredInput.value);
  if (!lowered.ok) return lowered;

  const source = buildZodSourceFile(lowered.value, output);
  if (!source.ok) return source;

  return mergeSuccess(
    source.value.sourceFile,
    parsedDocument,
    parsedOptions,
    prepared,
    loweredInput,
    lowered,
    source,
  );
};
