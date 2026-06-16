import type {
  InputDocument,
  InputPlugin,
  PreparedInput,
  ResolvedZodSourceOutputOptions,
  Result,
  ZodEmissionModuleInput,
  ZodSourceOutputOptions,
} from "@x2zod/core";
import type { z } from "zod/v4";

export type X2ZodInputPlugin<
  TKind extends string = string,
  TPreparedInput = unknown,
  TOptions = unknown,
  TOptionsInput = unknown,
> = InputPlugin<TPreparedInput, TOptions, TOptionsInput, TKind>;

export type X2ZodAnyInputPlugin<TKind extends string = string> = Readonly<{
  kind: TKind;
  lower: (input: PreparedInput<never>, options: never) => Promise<Result<ZodEmissionModuleInput>>;
  optionsSchema: z.ZodType;
  prepare: (document: InputDocument, options: never) => Promise<Result<PreparedInput<unknown>>>;
}>;

export type X2ZodInputPluginRegistry = Readonly<Record<string, X2ZodAnyInputPlugin>>;
export type X2ZodInputPluginKey<TPlugins extends X2ZodInputPluginRegistry> = Extract<
  keyof TPlugins,
  string
>;
export type X2ZodInputPluginRegistryFor<TPlugins extends X2ZodInputPluginRegistry> = Readonly<{
  [TKind in X2ZodInputPluginKey<TPlugins>]: TPlugins[TKind] extends X2ZodAnyInputPlugin<TKind>
    ? TPlugins[TKind]
    : never;
}>;

export type X2ZodCodeQualityContext = Readonly<{
  baseDirectory: string;
  outputPath?: string | undefined;
}>;

export type X2ZodCodeQualityPlugin<
  TOptions = unknown,
  TOptionsInput = TOptions,
  TKind extends string = string,
> = Readonly<{
  kind: TKind;
  optionsSchema: z.ZodType<TOptions, TOptionsInput>;
  transform: (
    sourceText: string,
    options: TOptions,
    context: X2ZodCodeQualityContext,
  ) => Promise<string> | string;
}>;

export type X2ZodAnyCodeQualityPlugin<TKind extends string = string> = Readonly<{
  kind: TKind;
  optionsSchema: z.ZodType;
  transform: (
    sourceText: string,
    options: never,
    context: X2ZodCodeQualityContext,
  ) => Promise<string> | string;
}>;

export type X2ZodCodeQualityRegistry = Readonly<Record<string, X2ZodAnyCodeQualityPlugin>>;
export type X2ZodEmptyCodeQualityRegistry = Readonly<Record<never, never>>;
export type X2ZodCodeQualityKey<TCodeQuality extends X2ZodCodeQualityRegistry> = Extract<
  keyof TCodeQuality,
  string
>;
export type X2ZodCodeQualityRegistryFor<TCodeQuality extends X2ZodCodeQualityRegistry> = Readonly<{
  [TKind in X2ZodCodeQualityKey<TCodeQuality>]: TCodeQuality[TKind] extends X2ZodAnyCodeQualityPlugin<TKind>
    ? TCodeQuality[TKind]
    : never;
}>;

export type X2ZodPluginConfig<
  TInput extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{
  codeQuality?: (TCodeQuality & X2ZodCodeQualityRegistryFor<TCodeQuality>) | undefined;
  input: TInput & X2ZodInputPluginRegistryFor<TInput>;
}>;

export type X2ZodResolvedPluginConfig<
  TInput extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{ codeQuality: TCodeQuality; input: TInput }>;

export type X2ZodOutputCodeQualityConfigItemFor<
  TCodeQuality extends X2ZodCodeQualityRegistry,
  TKind extends X2ZodCodeQualityKey<TCodeQuality>,
> = Readonly<{ kind: TKind; options?: z.input<TCodeQuality[TKind]["optionsSchema"]> | undefined }>;

export type X2ZodOutputCodeQualityConfigFor<
  TCodeQuality extends X2ZodCodeQualityRegistry,
  TKind extends X2ZodCodeQualityKey<TCodeQuality>,
> = X2ZodOutputCodeQualityConfigItemFor<TCodeQuality, TKind>;

export type X2ZodOutputCodeQualityConfigItem<TCodeQuality extends X2ZodCodeQualityRegistry> = {
  readonly [TKind in X2ZodCodeQualityKey<TCodeQuality>]: X2ZodOutputCodeQualityConfigItemFor<
    TCodeQuality,
    TKind
  >;
}[X2ZodCodeQualityKey<TCodeQuality>];

export type X2ZodOutputCodeQualityConfig<TCodeQuality extends X2ZodCodeQualityRegistry> =
  | X2ZodOutputCodeQualityConfigItem<TCodeQuality>
  | readonly X2ZodOutputCodeQualityConfigItem<TCodeQuality>[];

export type X2ZodResolvedOutputCodeQualityConfigItemFor<
  TCodeQuality extends X2ZodCodeQualityRegistry,
  TKind extends X2ZodCodeQualityKey<TCodeQuality>,
> = Readonly<{
  kind: TKind;
  options: z.output<TCodeQuality[TKind]["optionsSchema"]>;
  plugin: TCodeQuality[TKind];
}>;

export type X2ZodResolvedOutputCodeQualityConfigFor<
  TCodeQuality extends X2ZodCodeQualityRegistry,
  TKind extends X2ZodCodeQualityKey<TCodeQuality>,
> = X2ZodResolvedOutputCodeQualityConfigItemFor<TCodeQuality, TKind>;

export type X2ZodResolvedOutputCodeQualityConfigItem<
  TCodeQuality extends X2ZodCodeQualityRegistry,
> = {
  readonly [TKind in X2ZodCodeQualityKey<TCodeQuality>]: X2ZodResolvedOutputCodeQualityConfigItemFor<
    TCodeQuality,
    TKind
  >;
}[X2ZodCodeQualityKey<TCodeQuality>];

export type X2ZodResolvedOutputCodeQualityConfig<TCodeQuality extends X2ZodCodeQualityRegistry> =
  readonly X2ZodResolvedOutputCodeQualityConfigItem<TCodeQuality>[];

export type X2ZodFileInputConfig = Readonly<{ mediaType?: string | undefined; path: string }>;

export type X2ZodInlineInputConfig = Readonly<{
  id: string;
  mediaType?: string | undefined;
  text: string;
}>;

export type X2ZodUriInputConfig = Readonly<{ mediaType?: string | undefined; uri: string }>;

export type X2ZodInputConfig = X2ZodFileInputConfig | X2ZodInlineInputConfig | X2ZodUriInputConfig;

export type X2ZodOutputConfig<
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<
  ZodSourceOutputOptions & {
    codeQuality?: X2ZodOutputCodeQualityConfig<TCodeQuality> | undefined;
    path: string;
  }
>;

export type X2ZodResolvedOutputConfig<
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<
  ResolvedZodSourceOutputOptions & {
    codeQuality?: X2ZodResolvedOutputCodeQualityConfig<TCodeQuality> | undefined;
    path: string;
  }
>;

export type X2ZodTargetFor<
  TPlugins extends X2ZodInputPluginRegistry,
  TKind extends X2ZodInputPluginKey<TPlugins>,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  options?: z.input<TPlugins[TKind]["optionsSchema"]> | undefined;
  output: X2ZodOutputConfig<TCodeQuality>;
}>;

export type X2ZodTarget<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = {
  readonly [TKind in X2ZodInputPluginKey<TPlugins>]: X2ZodTargetFor<TPlugins, TKind, TCodeQuality>;
}[X2ZodInputPluginKey<TPlugins>];

export type X2ZodTargetMap<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<Record<string, X2ZodTarget<TPlugins, TCodeQuality>>>;

export type X2ZodConfig<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{
  plugins: X2ZodPluginConfig<TPlugins, TCodeQuality>;
  targets: X2ZodTargetMap<TPlugins, TCodeQuality>;
}>;

export type X2ZodResolvedTargetFor<
  TPlugins extends X2ZodInputPluginRegistry,
  TKind extends X2ZodInputPluginKey<TPlugins>,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  name: string;
  options: z.output<TPlugins[TKind]["optionsSchema"]>;
  output: X2ZodResolvedOutputConfig<TCodeQuality>;
  plugin: TPlugins[TKind];
}>;

export type X2ZodResolvedTarget<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = {
  readonly [TKind in X2ZodInputPluginKey<TPlugins>]: X2ZodResolvedTargetFor<
    TPlugins,
    TKind,
    TCodeQuality
  >;
}[X2ZodInputPluginKey<TPlugins>];

export type X2ZodResolvedTargetMap<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<Record<string, X2ZodResolvedTarget<TPlugins, TCodeQuality>>>;

export type X2ZodResolvedConfig<
  TPlugins extends X2ZodInputPluginRegistry,
  TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
> = Readonly<{
  configFile?: string | undefined;
  plugins: X2ZodResolvedPluginConfig<TPlugins, TCodeQuality>;
  targets: X2ZodResolvedTargetMap<TPlugins, TCodeQuality>;
}>;

export type X2ZodResolvedInputPluginRegistry<TPlugins extends X2ZodInputPluginRegistry> = Readonly<{
  configFile?: string | undefined;
  plugins: TPlugins;
}>;

export type X2ZodLoadedInputPlugin = X2ZodAnyInputPlugin;

export type X2ZodLoadedInputPluginRegistry = Readonly<Record<string, X2ZodLoadedInputPlugin>>;

export type X2ZodLoadedCodeQualityPlugin = X2ZodAnyCodeQualityPlugin;

export type X2ZodLoadedCodeQualityRegistry = Readonly<Record<string, X2ZodLoadedCodeQualityPlugin>>;

export type LoadX2ZodConfigOptions = Readonly<{
  configFile?: string | undefined;
  configFileRequired?: boolean | undefined;
  cwd?: string | undefined;
  overrides?:
    | Partial<X2ZodConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>>
    | undefined;
}>;

export type ResolveX2ZodConfigOptions = Readonly<{ configFile?: string | undefined }>;

export const defineConfig = <
  const TPlugins extends X2ZodInputPluginRegistry,
  const TCodeQuality extends X2ZodCodeQualityRegistry = X2ZodEmptyCodeQualityRegistry,
>(
  config: Readonly<{
    plugins: X2ZodPluginConfig<TPlugins, TCodeQuality>;
    targets: X2ZodTargetMap<TPlugins, TCodeQuality>;
  }>,
): X2ZodConfig<TPlugins, TCodeQuality> => config;
