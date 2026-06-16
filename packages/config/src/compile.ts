import { compileToZodSource } from "@x2zod/core";
import type {
  CompileToZodSourceResult,
  DeclarationExportMode,
  InputDocumentInput,
  InputPlugin,
  ZodSourceOutputOptions,
} from "@x2zod/core";

import type {
  X2ZodInputConfig,
  X2ZodLoadedCodeQualityRegistry,
  X2ZodLoadedInputPlugin,
  X2ZodLoadedInputPluginRegistry,
  X2ZodResolvedConfig,
  X2ZodResolvedTarget,
  X2ZodResolvedOutputConfig,
  X2ZodResolvedInputPluginRegistry,
} from "./types";
import {
  mergeZodCLIOptionOverrides,
  resolveZodCLIOptionOverrides,
} from "./zod-cli-option-overrides";
import type { ZodCLIOptionTransformContext } from "./zod-cli-option-overrides";

type ExecutableInputPlugin = InputPlugin<unknown, unknown, unknown>;

export type X2ZodCompilableOutput = Readonly<
  ZodSourceOutputOptions & {
    codeQuality?: X2ZodResolvedOutputConfig<X2ZodLoadedCodeQualityRegistry>["codeQuality"];
    path: string;
  }
>;

export type X2ZodCompilableTarget = Readonly<{
  input: X2ZodInputConfig;
  kind: string;
  name: string;
  options: unknown;
  output: X2ZodCompilableOutput;
  plugin: X2ZodLoadedInputPlugin;
}>;

export type X2ZodCompileTargetOverrides = Readonly<{
  declarationExportMode?: DeclarationExportMode | undefined;
  inlineId?: string | undefined;
  inputPath?: string | undefined;
  inlineText?: string | undefined;
  kind?: string | undefined;
  mediaType?: string | undefined;
  outputPath?: string | undefined;
  pluginOptions?: Readonly<Record<string, unknown>> | undefined;
  targetName?: string | undefined;
  typeName?: string | undefined;
  uri?: string | undefined;
  zodImportPath?: string | undefined;
}>;

export type X2ZodTargetInputLoader = (
  input: X2ZodInputConfig,
  target: X2ZodCompilableTarget,
) => Promise<InputDocumentInput>;

export type CompileX2ZodTargetRequest = Readonly<{
  document?: InputDocumentInput | undefined;
  loadInputDocument?: X2ZodTargetInputLoader | undefined;
  output?: ZodSourceOutputOptions | undefined;
  pluginOptions?: unknown;
  target:
    | X2ZodCompilableTarget
    | X2ZodResolvedTarget<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>;
}>;

export type ResolveX2ZodCompilableTargetRequest = Readonly<{
  config?:
    | X2ZodResolvedConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>
    | undefined;
  optionTransformContext: ZodCLIOptionTransformContext;
  overrides: X2ZodCompileTargetOverrides;
  pluginRegistry?: X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> | undefined;
}>;

export type ResolveX2ZodCompilableTargetResult = Readonly<{
  pluginOptions: unknown;
  target: X2ZodCompilableTarget;
}>;

const asExecutablePlugin = (plugin: X2ZodLoadedInputPlugin): ExecutableInputPlugin =>
  plugin as unknown as ExecutableInputPlugin;

const withMediaType = <TValue extends object>(
  value: TValue,
  mediaType: string | undefined,
): TValue | (TValue & Readonly<{ mediaType: string }>) =>
  mediaType === undefined ? value : { ...value, mediaType };

const inputFromOverrides = (
  overrides: X2ZodCompileTargetOverrides,
): X2ZodInputConfig | undefined => {
  const providedInputs = [overrides.inputPath, overrides.uri, overrides.inlineText].filter(
    (value) => value !== undefined,
  );

  if (providedInputs.length === 0) return undefined;
  if (providedInputs.length > 1) throw new Error("Pass only one of --input, --uri, or --text.");

  if (overrides.inputPath !== undefined)
    return withMediaType({ path: overrides.inputPath }, overrides.mediaType);
  if (overrides.uri !== undefined)
    return withMediaType({ uri: overrides.uri }, overrides.mediaType);

  return withMediaType(
    { id: overrides.inlineId ?? "inline", text: overrides.inlineText ?? "" },
    overrides.mediaType,
  );
};

const requireValue = (value: string | undefined, optionName: string): string => {
  if (value !== undefined) return value;
  throw new Error(`Missing required ${optionName} option.`);
};

const outputFromAnonymousOverrides = (
  overrides: X2ZodCompileTargetOverrides,
): X2ZodCompilableOutput => ({
  path: requireValue(overrides.outputPath, "--output"),
  typeName: requireValue(overrides.typeName, "--type-name"),
  ...(overrides.declarationExportMode === undefined
    ? {}
    : { declarationExportMode: overrides.declarationExportMode }),
  ...(overrides.zodImportPath === undefined ? {} : { zodImportPath: overrides.zodImportPath }),
});

const outputWithOverrides = (
  output: X2ZodResolvedOutputConfig<X2ZodLoadedCodeQualityRegistry>,
  overrides: X2ZodCompileTargetOverrides,
): X2ZodCompilableOutput => ({
  ...(output.codeQuality === undefined ? {} : { codeQuality: output.codeQuality }),
  declarationExportMode: overrides.declarationExportMode ?? output.declarationExportMode,
  path: overrides.outputPath ?? output.path,
  typeName: overrides.typeName ?? output.typeName,
  zodImportPath: overrides.zodImportPath ?? output.zodImportPath,
});

const availableAnonymousPluginRegistry = (
  pluginRegistry: X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> | undefined,
): X2ZodLoadedInputPluginRegistry => pluginRegistry?.plugins ?? {};

const requireAnonymousPlugin = (
  kind: string,
  pluginRegistry: X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> | undefined,
): X2ZodLoadedInputPlugin => {
  const plugin = availableAnonymousPluginRegistry(pluginRegistry)[kind];
  if (plugin !== undefined) return plugin;
  throw new Error(`Unknown input plugin kind ${kind}.`);
};

const targetNames = (
  config: X2ZodResolvedConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>,
): string => Object.keys(config.targets).join(", ");

const resolveAnonymousCompilableTarget = async ({
  optionTransformContext,
  overrides,
  pluginRegistry,
}: ResolveX2ZodCompilableTargetRequest): Promise<ResolveX2ZodCompilableTargetResult> => {
  const input = inputFromOverrides(overrides);
  if (input === undefined) throw new Error("Missing required input option.");
  const kind = requireValue(overrides.kind, "--kind");
  const plugin = requireAnonymousPlugin(kind, pluginRegistry);
  const pluginOptions = await resolveZodCLIOptionOverrides(
    plugin.optionsSchema,
    overrides.pluginOptions ?? {},
    optionTransformContext,
  );

  return {
    pluginOptions,
    target: {
      input,
      kind,
      name: "<anonymous>",
      options: pluginOptions,
      output: outputFromAnonymousOverrides(overrides),
      plugin,
    },
  };
};

const resolveConfiguredCompilableTarget = async ({
  config,
  optionTransformContext,
  overrides,
}: ResolveX2ZodCompilableTargetRequest &
  Readonly<{
    config: X2ZodResolvedConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>;
  }>): Promise<ResolveX2ZodCompilableTargetResult> => {
  const targetName = requireValue(overrides.targetName, "--target");
  const target = config.targets[targetName];
  if (target === undefined)
    throw new Error(`Unknown target ${targetName}. Available targets: ${targetNames(config)}.`);
  if (overrides.kind !== undefined && overrides.kind !== target.kind)
    throw new Error(`Target ${targetName} uses kind ${target.kind}, not ${overrides.kind}.`);

  const pluginOptions = await mergeZodCLIOptionOverrides({
    context: optionTransformContext,
    existingOptions: target.options,
    overrides: overrides.pluginOptions ?? {},
    schema: target.plugin.optionsSchema,
  });
  return {
    pluginOptions,
    target: {
      ...target,
      input: inputFromOverrides(overrides) ?? target.input,
      options: pluginOptions,
      output: outputWithOverrides(target.output, overrides),
    },
  };
};

export const zodSourceOutputOptionsForConfig = (
  output: X2ZodCompilableOutput,
): ZodSourceOutputOptions => ({
  ...(output.declarationExportMode === undefined
    ? {}
    : { declarationExportMode: output.declarationExportMode }),
  typeName: output.typeName,
  ...(output.zodImportPath === undefined ? {} : { zodImportPath: output.zodImportPath }),
});

const inputDocumentForTarget = async ({
  document,
  loadInputDocument,
  target,
}: CompileX2ZodTargetRequest): Promise<InputDocumentInput> => {
  if (document !== undefined) return document;
  if (loadInputDocument !== undefined) {
    const loaded = await loadInputDocument(target.input, target);
    return loaded;
  }
  throw new Error("Pass document or loadInputDocument to compile a resolved x2zod target.");
};

export const resolveX2ZodCompilableTarget = async (
  request: ResolveX2ZodCompilableTargetRequest,
): Promise<ResolveX2ZodCompilableTargetResult> => {
  await Promise.resolve();
  return request.config === undefined
    ? resolveAnonymousCompilableTarget(request)
    : resolveConfiguredCompilableTarget({ ...request, config: request.config });
};

export const compileX2ZodTarget = async (
  request: CompileX2ZodTargetRequest,
): Promise<CompileToZodSourceResult> => {
  const { output, pluginOptions, target } = request;
  const document = await inputDocumentForTarget(request);
  return compileToZodSource({
    document,
    output: output ?? zodSourceOutputOptionsForConfig(target.output),
    plugin: asExecutablePlugin(target.plugin),
    pluginOptions: pluginOptions ?? target.options,
  });
};
