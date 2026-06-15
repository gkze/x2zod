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

export type X2ZodConfigPlugin<
  TKind extends string = string,
  TPreparedInput = unknown,
  TOptions = unknown,
  TOptionsInput = unknown,
> = InputPlugin<TPreparedInput, TOptions, TOptionsInput, TKind>;

export type X2ZodAnyConfigPlugin<TKind extends string = string> = Readonly<{
  kind: TKind;
  lower: (input: PreparedInput<never>, options: never) => Promise<Result<ZodEmissionModuleInput>>;
  optionsSchema: z.ZodType;
  prepare: (document: InputDocument, options: never) => Promise<Result<PreparedInput<unknown>>>;
}>;

export type X2ZodPluginRegistry = Readonly<Record<string, X2ZodAnyConfigPlugin>>;
export type X2ZodPluginKey<TPlugins extends X2ZodPluginRegistry> = Extract<keyof TPlugins, string>;
export type X2ZodPluginRegistryFor<TPlugins extends X2ZodPluginRegistry> = Readonly<{
  [TKind in X2ZodPluginKey<TPlugins>]: TPlugins[TKind] extends X2ZodAnyConfigPlugin<TKind>
    ? TPlugins[TKind]
    : never;
}>;

export type X2ZodFileInputConfig = Readonly<{ mediaType?: string | undefined; path: string }>;

export type X2ZodInlineInputConfig = Readonly<{
  id: string;
  mediaType?: string | undefined;
  text: string;
}>;

export type X2ZodUriInputConfig = Readonly<{ mediaType?: string | undefined; uri: string }>;

export type X2ZodInputConfig = X2ZodFileInputConfig | X2ZodInlineInputConfig | X2ZodUriInputConfig;

export type X2ZodOutputConfig = Readonly<ZodSourceOutputOptions & { path: string }>;

export type X2ZodResolvedOutputConfig = Readonly<ResolvedZodSourceOutputOptions & { path: string }>;

export type X2ZodTargetFor<
  TPlugins extends X2ZodPluginRegistry,
  TKind extends X2ZodPluginKey<TPlugins>,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  options?: z.input<TPlugins[TKind]["optionsSchema"]> | undefined;
  output: X2ZodOutputConfig;
}>;

export type X2ZodTarget<TPlugins extends X2ZodPluginRegistry> = {
  readonly [TKind in X2ZodPluginKey<TPlugins>]: X2ZodTargetFor<TPlugins, TKind>;
}[X2ZodPluginKey<TPlugins>];

export type X2ZodTargetMap<TPlugins extends X2ZodPluginRegistry> = Readonly<
  Record<string, X2ZodTarget<TPlugins>>
>;

export type X2ZodConfig<TPlugins extends X2ZodPluginRegistry> = Readonly<{
  plugins: X2ZodPluginRegistryFor<TPlugins>;
  targets: X2ZodTargetMap<TPlugins>;
}>;

export type X2ZodResolvedTargetFor<
  TPlugins extends X2ZodPluginRegistry,
  TKind extends X2ZodPluginKey<TPlugins>,
> = Readonly<{
  input: X2ZodInputConfig;
  kind: TKind;
  name: string;
  options: z.output<TPlugins[TKind]["optionsSchema"]>;
  output: X2ZodResolvedOutputConfig;
  plugin: TPlugins[TKind];
}>;

export type X2ZodResolvedTarget<TPlugins extends X2ZodPluginRegistry> = {
  readonly [TKind in X2ZodPluginKey<TPlugins>]: X2ZodResolvedTargetFor<TPlugins, TKind>;
}[X2ZodPluginKey<TPlugins>];

export type X2ZodResolvedTargetMap<TPlugins extends X2ZodPluginRegistry> = Readonly<
  Record<string, X2ZodResolvedTarget<TPlugins>>
>;

export type X2ZodResolvedConfig<TPlugins extends X2ZodPluginRegistry> = Readonly<{
  configFile?: string | undefined;
  plugins: TPlugins;
  targets: X2ZodResolvedTargetMap<TPlugins>;
}>;

export type X2ZodResolvedPluginRegistry<TPlugins extends X2ZodPluginRegistry> = Readonly<{
  configFile?: string | undefined;
  plugins: TPlugins;
}>;

export type X2ZodLoadedConfigPlugin = X2ZodAnyConfigPlugin;

export type X2ZodLoadedPluginRegistry = Readonly<Record<string, X2ZodLoadedConfigPlugin>>;

export type LoadX2ZodConfigOptions = Readonly<{
  configFile?: string | undefined;
  configFileRequired?: boolean | undefined;
  cwd?: string | undefined;
  overrides?: Partial<X2ZodConfig<X2ZodLoadedPluginRegistry>> | undefined;
}>;

export type ResolveX2ZodConfigOptions = Readonly<{ configFile?: string | undefined }>;

export const defineConfig = <const TPlugins extends X2ZodPluginRegistry>(
  config: Readonly<{
    plugins: TPlugins & X2ZodPluginRegistryFor<TPlugins>;
    targets: X2ZodTargetMap<TPlugins>;
  }>,
): X2ZodConfig<TPlugins> => config;
