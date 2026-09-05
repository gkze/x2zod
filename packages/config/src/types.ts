import type { z } from "zod/v4";

import type {
  InputDocument,
  InputPlugin,
  PreparedInput,
  ResolvedZodSourceOutputOptions,
  Result,
  ZodEmissionTransform,
  ZodEmissionTransformInput,
  ZodEmissionModuleInput,
  ZodSourceOutputOptions,
} from "@x2zod/core";

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

export type X2ZodOutputProcessorContext = Readonly<{
  baseDirectory: string;
  outputPath?: string | undefined;
}>;

export type X2ZodOutputProcessorPlugin<
  TOptions = unknown,
  TOptionsInput = TOptions,
  TKind extends string = string,
> = Readonly<{
  kind: TKind;
  optionsSchema: z.ZodType<TOptions, TOptionsInput>;
  transform: (
    sourceText: string,
    options: TOptions,
    context: X2ZodOutputProcessorContext,
  ) => Promise<string> | string;
}>;

export type X2ZodAnyOutputProcessorPlugin<TKind extends string = string> = Readonly<{
  kind: TKind;
  optionsSchema: z.ZodType;
  transform: (
    sourceText: string,
    options: never,
    context: X2ZodOutputProcessorContext,
  ) => Promise<string> | string;
}>;

export type X2ZodOutputProcessorRegistry = Readonly<Record<string, X2ZodAnyOutputProcessorPlugin>>;
export type X2ZodEmptyOutputProcessorRegistry = Readonly<Record<never, never>>;
export type X2ZodOutputProcessorKey<TOutputProcessors extends X2ZodOutputProcessorRegistry> =
  Extract<keyof TOutputProcessors, string>;
export type X2ZodOutputProcessorRegistryFor<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
> = Readonly<{
  [TKind in X2ZodOutputProcessorKey<TOutputProcessors>]: TOutputProcessors[TKind] extends X2ZodAnyOutputProcessorPlugin<TKind>
    ? TOutputProcessors[TKind]
    : never;
}>;

export type X2ZodPluginConfig<
  TInput extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{
  input: TInput & X2ZodInputPluginRegistryFor<TInput>;
  output?: (TOutputProcessors & X2ZodOutputProcessorRegistryFor<TOutputProcessors>) | undefined;
}>;

export type X2ZodResolvedPluginConfig<
  TInput extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{ input: TInput; output: TOutputProcessors }>;

export type X2ZodOutputProcessorConfigItemFor<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
  TKind extends X2ZodOutputProcessorKey<TOutputProcessors>,
> = Readonly<{
  kind: TKind;
  options?: z.input<TOutputProcessors[TKind]["optionsSchema"]> | undefined;
}>;

export type X2ZodOutputProcessorConfigFor<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
  TKind extends X2ZodOutputProcessorKey<TOutputProcessors>,
> = X2ZodOutputProcessorConfigItemFor<TOutputProcessors, TKind>;

export type X2ZodOutputProcessorConfigItem<TOutputProcessors extends X2ZodOutputProcessorRegistry> =
  {
    readonly [TKind in X2ZodOutputProcessorKey<TOutputProcessors>]: X2ZodOutputProcessorConfigItemFor<
      TOutputProcessors,
      TKind
    >;
  }[X2ZodOutputProcessorKey<TOutputProcessors>];

export type X2ZodOutputProcessorConfig<TOutputProcessors extends X2ZodOutputProcessorRegistry> =
  | X2ZodOutputProcessorConfigItem<TOutputProcessors>
  | readonly X2ZodOutputProcessorConfigItem<TOutputProcessors>[];

export type X2ZodResolvedOutputProcessorConfigItemFor<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
  TKind extends X2ZodOutputProcessorKey<TOutputProcessors>,
> = Readonly<{
  kind: TKind;
  options: z.output<TOutputProcessors[TKind]["optionsSchema"]>;
  plugin: TOutputProcessors[TKind];
}>;

export type X2ZodResolvedOutputProcessorConfigFor<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
  TKind extends X2ZodOutputProcessorKey<TOutputProcessors>,
> = X2ZodResolvedOutputProcessorConfigItemFor<TOutputProcessors, TKind>;

export type X2ZodResolvedOutputProcessorConfigItem<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
> = {
  readonly [TKind in X2ZodOutputProcessorKey<TOutputProcessors>]: X2ZodResolvedOutputProcessorConfigItemFor<
    TOutputProcessors,
    TKind
  >;
}[X2ZodOutputProcessorKey<TOutputProcessors>];

export type X2ZodResolvedOutputProcessorConfig<
  TOutputProcessors extends X2ZodOutputProcessorRegistry,
> = readonly X2ZodResolvedOutputProcessorConfigItem<TOutputProcessors>[];

export type X2ZodFileInputConfig = Readonly<{ mediaType?: string | undefined; path: string }>;

export type X2ZodInlineInputConfig = Readonly<{
  id: string;
  mediaType?: string | undefined;
  text: string;
}>;

export type X2ZodUriInputConfig = Readonly<{ mediaType?: string | undefined; uri: string }>;

export type X2ZodInputConfig = X2ZodFileInputConfig | X2ZodInlineInputConfig | X2ZodUriInputConfig;

export type X2ZodTargetTransformConfigItem = ZodEmissionTransformInput;
export type X2ZodTargetTransformConfig = readonly X2ZodTargetTransformConfigItem[];
export type X2ZodResolvedTargetTransformConfigItem = ZodEmissionTransform;
export type X2ZodResolvedTargetTransformConfig = readonly X2ZodResolvedTargetTransformConfigItem[];

export type X2ZodOutputConfig<
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<
  ZodSourceOutputOptions & {
    path: string;
    processors?: X2ZodOutputProcessorConfig<TOutputProcessors> | undefined;
  }
>;

export type X2ZodResolvedOutputConfig<
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<
  ResolvedZodSourceOutputOptions & {
    path: string;
    processors?: X2ZodResolvedOutputProcessorConfig<TOutputProcessors> | undefined;
  }
>;

export type X2ZodTargetFor<
  TPlugins extends X2ZodInputPluginRegistry,
  TKind extends X2ZodInputPluginKey<TPlugins>,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  options?: z.input<TPlugins[TKind]["optionsSchema"]> | undefined;
  output: X2ZodOutputConfig<TOutputProcessors>;
  transforms?: X2ZodTargetTransformConfig | undefined;
}>;

export type X2ZodTarget<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = {
  readonly [TKind in X2ZodInputPluginKey<TPlugins>]: X2ZodTargetFor<
    TPlugins,
    TKind,
    TOutputProcessors
  >;
}[X2ZodInputPluginKey<TPlugins>];

export type X2ZodTargetMap<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<Record<string, X2ZodTarget<TPlugins, TOutputProcessors>>>;

export type X2ZodConfig<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{
  plugins: X2ZodPluginConfig<TPlugins, TOutputProcessors>;
  targets: X2ZodTargetMap<TPlugins, TOutputProcessors>;
}>;

export type X2ZodResolvedTargetFor<
  TPlugins extends X2ZodInputPluginRegistry,
  TKind extends X2ZodInputPluginKey<TPlugins>,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  name: string;
  options: z.output<TPlugins[TKind]["optionsSchema"]>;
  optionsInput: z.input<TPlugins[TKind]["optionsSchema"]>;
  optionsResolved: true;
  output: X2ZodResolvedOutputConfig<TOutputProcessors>;
  plugin: TPlugins[TKind];
  transforms: X2ZodResolvedTargetTransformConfig;
}>;

export type X2ZodResolvedTarget<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = {
  readonly [TKind in X2ZodInputPluginKey<TPlugins>]: X2ZodResolvedTargetFor<
    TPlugins,
    TKind,
    TOutputProcessors
  >;
}[X2ZodInputPluginKey<TPlugins>];

export type X2ZodResolvedTargetMap<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<Record<string, X2ZodResolvedTarget<TPlugins, TOutputProcessors>>>;

export type X2ZodResolvedConfig<
  TPlugins extends X2ZodInputPluginRegistry,
  TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
> = Readonly<{
  configFile?: string | undefined;
  plugins: X2ZodResolvedPluginConfig<TPlugins, TOutputProcessors>;
  targets: X2ZodResolvedTargetMap<TPlugins, TOutputProcessors>;
}>;

export type X2ZodResolvedInputPluginRegistry<TPlugins extends X2ZodInputPluginRegistry> = Readonly<{
  configFile?: string | undefined;
  plugins: TPlugins;
}>;

export type X2ZodLoadedInputPlugin = X2ZodAnyInputPlugin;

export type X2ZodLoadedInputPluginRegistry = Readonly<Record<string, X2ZodLoadedInputPlugin>>;

export type X2ZodLoadedOutputProcessorPlugin = X2ZodAnyOutputProcessorPlugin;

export type X2ZodLoadedOutputProcessorRegistry = Readonly<
  Record<string, X2ZodLoadedOutputProcessorPlugin>
>;

export type LoadX2ZodConfigOptions = Readonly<{
  configFile?: string | undefined;
  configFileRequired?: boolean | undefined;
  cwd?: string | undefined;
  overrides?:
    | Partial<X2ZodConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedOutputProcessorRegistry>>
    | undefined;
}>;

export type ResolveX2ZodConfigOptions = Readonly<{ configFile?: string | undefined }>;

export const defineConfig = <
  const TPlugins extends X2ZodInputPluginRegistry,
  const TOutputProcessors extends X2ZodOutputProcessorRegistry = X2ZodEmptyOutputProcessorRegistry,
>(
  config: Readonly<{
    plugins: X2ZodPluginConfig<TPlugins, TOutputProcessors>;
    targets: X2ZodTargetMap<TPlugins, TOutputProcessors>;
  }>,
): X2ZodConfig<TPlugins, TOutputProcessors> => config;
