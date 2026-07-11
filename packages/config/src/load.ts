import { loadConfig as loadC12Config } from "c12";
import type { LoadConfigOptions } from "c12";
import type { z } from "zod/v4";
import { z as zod } from "zod/v4";

import { declarationExportModeSchema, resolveZodSourceOutputOptions } from "@x2zod/core";

import { X2ZodConfigError } from "./errors";
import type { X2ZodConfigIssue, X2ZodConfigPathSegment } from "./errors";
import { isRecord } from "./structural";
import type { UnknownRecord } from "./structural";
import type {
  LoadX2ZodConfigOptions,
  ResolveX2ZodConfigOptions,
  X2ZodConfig,
  X2ZodCodeQualityRegistry,
  X2ZodInputConfig,
  X2ZodLoadedCodeQualityRegistry,
  X2ZodLoadedCodeQualityPlugin,
  X2ZodLoadedInputPlugin,
  X2ZodLoadedInputPluginRegistry,
  X2ZodOutputCodeQualityConfigItem,
  X2ZodOutputConfig,
  X2ZodInputPluginRegistry,
  X2ZodInputPluginRegistryFor,
  X2ZodResolvedConfig,
  X2ZodResolvedOutputCodeQualityConfigItem,
  X2ZodResolvedOutputConfig,
  X2ZodResolvedInputPluginRegistry,
  X2ZodResolvedTarget,
  X2ZodResolvedTargetMap,
  X2ZodTarget,
} from "./types";
import { ZodCLIOptionSchemaError, assertSupportedZodCLIOptionSchema } from "./zod-to-optique";

type C12LoadedConfig = Readonly<{ config: unknown; configFile?: string | undefined }>;

const nonEmptyStringLength = 1;
const configPackageJsonKey = "x2zod";
const configName = "x2zod";
const c12ResolvedConfigFileKey = "_configFile";
const emptyOptions = {} as const;

const nonEmptyStringSchema = zod.string().min(nonEmptyStringLength);

const inputConfigSchema: z.ZodType<X2ZodInputConfig, X2ZodInputConfig> = zod.union([
  zod
    .strictObject({ mediaType: nonEmptyStringSchema.optional(), path: nonEmptyStringSchema })
    .readonly(),
  zod.strictObject({ mediaType: nonEmptyStringSchema.optional(), uri: zod.url() }).readonly(),
  zod
    .strictObject({
      id: nonEmptyStringSchema,
      mediaType: nonEmptyStringSchema.optional(),
      text: zod.string(),
    })
    .readonly(),
]);

const outputCodeQualityConfigSchema = zod
  .strictObject({ kind: nonEmptyStringSchema, options: zod.unknown().optional() })
  .readonly();
const outputCodeQualityPipelineConfigSchema = zod.union([
  outputCodeQualityConfigSchema,
  outputCodeQualityConfigSchema.array().readonly(),
]);

const outputConfigSchema: z.ZodType<
  X2ZodOutputConfig<X2ZodLoadedCodeQualityRegistry>,
  X2ZodOutputConfig<X2ZodLoadedCodeQualityRegistry>
> = zod
  .strictObject({
    codeQuality: outputCodeQualityPipelineConfigSchema.optional(),
    declarationExportMode: declarationExportModeSchema.optional(),
    path: nonEmptyStringSchema,
    typeName: nonEmptyStringSchema,
    zodImportPath: nonEmptyStringSchema.optional(),
  })
  .readonly();

const targetConfigSchema: z.ZodType<
  X2ZodTarget<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>,
  X2ZodTarget<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>
> = zod
  .strictObject({
    input: inputConfigSchema,
    kind: nonEmptyStringSchema,
    options: zod.unknown().optional(),
    output: outputConfigSchema,
  })
  .readonly();

type ReadPluginOptionsContext = Readonly<{
  issues: X2ZodConfigIssue[];
  path: readonly X2ZodConfigPathSegment[];
  plugin: X2ZodLoadedInputPlugin;
  value: unknown;
}>;

type ReadResolvedTargetContext = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  issues: X2ZodConfigIssue[];
  name: string;
  plugins: X2ZodLoadedInputPluginRegistry;
  value: unknown;
}>;

type ReadResolvedOutputContext = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  issues: X2ZodConfigIssue[];
  output: X2ZodOutputConfig<X2ZodLoadedCodeQualityRegistry>;
  path: readonly X2ZodConfigPathSegment[];
}>;

type ReadResolvedCodeQualityContext = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  issues: X2ZodConfigIssue[];
  path: readonly X2ZodConfigPathSegment[];
  value: X2ZodOutputConfig<X2ZodLoadedCodeQualityRegistry>["codeQuality"];
}>;

type ReadResolvedCodeQualityItemContext = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  issues: X2ZodConfigIssue[];
  path: readonly X2ZodConfigPathSegment[];
  value: X2ZodOutputCodeQualityConfigItem<X2ZodLoadedCodeQualityRegistry>;
}>;

type ReadResolvedTargetsContext = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  issues: X2ZodConfigIssue[];
  plugins: X2ZodLoadedInputPluginRegistry;
  value: unknown;
}>;

type LoadedPluginConfig = Readonly<{
  codeQuality: X2ZodLoadedCodeQualityRegistry;
  input: X2ZodLoadedInputPluginRegistry;
}>;

const isZodSchema = (value: unknown): value is z.ZodType =>
  isRecord(value) &&
  typeof value["parse"] === "function" &&
  typeof value["safeParse"] === "function";

const createIssue = (
  path: readonly X2ZodConfigPathSegment[],
  message: string,
): X2ZodConfigIssue => ({ message, path });

const addZodIssues = (
  issues: X2ZodConfigIssue[],
  path: readonly X2ZodConfigPathSegment[],
  error: z.ZodError,
): void => {
  for (const issue of error.issues)
    issues.push(createIssue([...path, ...issue.path.map(String)], issue.message));
};

const assertNoIssues = (issues: readonly X2ZodConfigIssue[]): void => {
  if (issues.length > 0) throw new X2ZodConfigError(issues);
};

const hasLoadedConfig = (value: unknown, configFile: string | undefined): boolean =>
  configFile !== undefined || (isRecord(value) && Object.keys(value).length > 0);

const assertRequiredConfigLoaded = (value: unknown, configFile: string | undefined): void => {
  if (!hasLoadedConfig(value, configFile))
    throw new X2ZodConfigError([createIssue([], "Required config")]);
};

const resolvedConfigFile = (loaded: C12LoadedConfig): string | undefined => {
  const value = (loaded as UnknownRecord)[c12ResolvedConfigFileKey];
  return typeof value === "string" ? value : undefined;
};

const c12LoadOptions = (
  options: LoadX2ZodConfigOptions,
  configFileRequired: boolean,
): LoadConfigOptions<Record<string, unknown>> => {
  const loadOptions: LoadConfigOptions<Record<string, unknown>> = {
    configFileRequired,
    dotenv: false,
    envName: false,
    globalRc: false,
    name: configName,
    packageJson: configPackageJsonKey,
  };

  if (options.configFile !== undefined) loadOptions.configFile = options.configFile;
  if (options.cwd !== undefined) loadOptions.cwd = options.cwd;
  if (options.overrides !== undefined) loadOptions.overrides = options.overrides;

  return loadOptions;
};

const readConfigRecord = (value: unknown): UnknownRecord => {
  if (isRecord(value)) return value;
  throw new X2ZodConfigError([createIssue([], "expected a config object")]);
};

const readPluginRegistry = (
  value: unknown,
  issues: X2ZodConfigIssue[],
  path: readonly X2ZodConfigPathSegment[],
): X2ZodLoadedInputPluginRegistry => {
  if (!isRecord(value)) {
    issues.push(createIssue(path, "expected an input plugin registry object"));
    return {};
  }

  const plugins: Record<string, X2ZodLoadedInputPlugin> = {};

  for (const [key, pluginValue] of Object.entries(value)) {
    const plugin = readPluginRegistryEntry({ issues, key, path, value: pluginValue });
    if (plugin !== undefined) plugins[key] = plugin;
  }

  return plugins;
};

const readPluginRegistryEntry = ({
  issues,
  key,
  path: registryPath,
  value,
}: Readonly<{
  issues: X2ZodConfigIssue[];
  key: string;
  path: readonly X2ZodConfigPathSegment[];
  value: unknown;
}>): X2ZodLoadedInputPlugin | undefined => {
  const path = [...registryPath, key] as const;
  if (key.length === 0) {
    issues.push(createIssue(path, "plugin keys must not be empty"));
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(createIssue(path, "expected an input plugin object"));
    return undefined;
  }

  const { kind, lower, optionsSchema, prepare } = value;
  const hasValidLower = typeof lower === "function";
  const hasValidOptionsSchema = isZodSchema(optionsSchema);
  const hasValidPrepare = typeof prepare === "function";
  const hasSupportedCLIOptionsSchema =
    hasValidOptionsSchema && readSupportedCLIOptionsSchema(optionsSchema, path, issues);

  if (typeof kind !== "string" || kind.length === 0) {
    issues.push(createIssue([...path, "kind"], "expected a non-empty plugin kind"));
    return undefined;
  }
  if (kind !== key) issues.push(createIssue([...path, "kind"], "plugin kind must match its key"));
  if (!hasValidOptionsSchema)
    issues.push(createIssue([...path, "optionsSchema"], "expected a Zod options schema"));
  if (!hasValidPrepare)
    issues.push(createIssue([...path, "prepare"], "expected a prepare function"));
  if (!hasValidLower) issues.push(createIssue([...path, "lower"], "expected a lower function"));

  return kind === key &&
    hasValidLower &&
    hasValidOptionsSchema &&
    hasSupportedCLIOptionsSchema &&
    hasValidPrepare
    ? (value as unknown as X2ZodLoadedInputPlugin)
    : undefined;
};

const readCodeQualityRegistry = (
  value: unknown,
  issues: X2ZodConfigIssue[],
  path: readonly X2ZodConfigPathSegment[],
): X2ZodLoadedCodeQualityRegistry => {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    issues.push(createIssue(path, "expected a code quality plugin registry object"));
    return {};
  }

  const codeQuality: Record<string, X2ZodLoadedCodeQualityPlugin> = {};

  for (const [key, pluginValue] of Object.entries(value)) {
    const plugin = readCodeQualityRegistryEntry({ issues, key, path, value: pluginValue });
    if (plugin !== undefined) codeQuality[key] = plugin;
  }

  return codeQuality;
};

const readCodeQualityRegistryEntry = ({
  issues,
  key,
  path: registryPath,
  value,
}: Readonly<{
  issues: X2ZodConfigIssue[];
  key: string;
  path: readonly X2ZodConfigPathSegment[];
  value: unknown;
}>): X2ZodLoadedCodeQualityPlugin | undefined => {
  const path = [...registryPath, key] as const;
  if (key.length === 0) {
    issues.push(createIssue(path, "code quality keys must not be empty"));
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(createIssue(path, "expected a code quality plugin object"));
    return undefined;
  }

  const { kind, optionsSchema, transform } = value;
  const hasValidOptionsSchema = isZodSchema(optionsSchema);
  const hasValidTransform = typeof transform === "function";

  if (typeof kind !== "string" || kind.length === 0) {
    issues.push(createIssue([...path, "kind"], "expected a non-empty code quality kind"));
    return undefined;
  }
  if (kind !== key)
    issues.push(createIssue([...path, "kind"], "code quality plugin kind must match its key"));
  if (!hasValidOptionsSchema)
    issues.push(createIssue([...path, "optionsSchema"], "expected a Zod options schema"));
  if (!hasValidTransform)
    issues.push(createIssue([...path, "transform"], "expected a transform function"));

  return kind === key && hasValidOptionsSchema && hasValidTransform
    ? (value as unknown as X2ZodLoadedCodeQualityPlugin)
    : undefined;
};

const readPluginConfig = (value: unknown, issues: X2ZodConfigIssue[]): LoadedPluginConfig => {
  if (!isRecord(value)) {
    issues.push(createIssue(["plugins"], "expected a plugin config object"));
    return { codeQuality: {}, input: {} };
  }

  return {
    codeQuality: readCodeQualityRegistry(value["codeQuality"], issues, ["plugins", "codeQuality"]),
    input: readPluginRegistry(value["input"], issues, ["plugins", "input"]),
  };
};

const readSupportedCLIOptionsSchema = (
  schema: z.ZodType,
  path: readonly X2ZodConfigPathSegment[],
  issues: X2ZodConfigIssue[],
): boolean => {
  try {
    assertSupportedZodCLIOptionSchema(schema);
    return true;
  } catch (error) {
    if (!(error instanceof ZodCLIOptionSchemaError)) throw error;
    issues.push(
      createIssue([...path, "optionsSchema"], `unsupported CLI option schema: ${error.message}`),
    );
    return false;
  }
};

const readResolvedOutput = ({
  codeQuality,
  issues,
  output,
  path,
}: ReadResolvedOutputContext):
  | X2ZodResolvedOutputConfig<X2ZodLoadedCodeQualityRegistry>
  | undefined => {
  const { codeQuality: codeQualityConfig, path: outputPath, ...sourceOutputOptions } = output;
  const resolved = resolveZodSourceOutputOptions(sourceOutputOptions);
  if (!resolved.ok) {
    for (const diagnostic of resolved.diagnostics)
      issues.push(createIssue(path, diagnostic.message));
    return undefined;
  }

  const resolvedCodeQuality = readResolvedCodeQuality({
    codeQuality,
    issues,
    path: [...path, "codeQuality"],
    value: codeQualityConfig,
  });
  if (codeQualityConfig !== undefined && resolvedCodeQuality === undefined) return undefined;

  return {
    ...resolved.value,
    ...(resolvedCodeQuality === undefined ? {} : { codeQuality: resolvedCodeQuality }),
    path: outputPath,
  };
};

const readPluginOptions = (context: ReadPluginOptionsContext): unknown => {
  const { issues, path, plugin, value } = context;
  const parsed = plugin.optionsSchema.safeParse(value === undefined ? emptyOptions : value);
  if (parsed.success) return parsed.data;

  addZodIssues(issues, path, parsed.error);
  return undefined;
};

const readResolvedCodeQuality = ({
  codeQuality,
  issues,
  path,
  value,
}: ReadResolvedCodeQualityContext):
  | X2ZodResolvedOutputConfig<X2ZodLoadedCodeQualityRegistry>["codeQuality"]
  | undefined => {
  if (value === undefined) return undefined;
  const isPipeline = Array.isArray(value);
  const values: readonly X2ZodOutputCodeQualityConfigItem<X2ZodLoadedCodeQualityRegistry>[] =
    isPipeline ? value : [value];
  const resolved = values
    .map((item, index) =>
      readResolvedCodeQualityItem({
        codeQuality,
        issues,
        path: isPipeline ? [...path, index] : path,
        value: item,
      }),
    )
    .filter((item) => item !== undefined);

  return resolved.length === values.length ? resolved : undefined;
};

const readResolvedCodeQualityItem = ({
  codeQuality,
  issues,
  path,
  value,
}: ReadResolvedCodeQualityItemContext):
  | X2ZodResolvedOutputCodeQualityConfigItem<X2ZodLoadedCodeQualityRegistry>
  | undefined => {
  const plugin = codeQuality[value.kind];
  if (plugin === undefined) {
    issues.push(
      createIssue([...path, "kind"], ["unknown code quality kind", value.kind].join(" ")),
    );
    return undefined;
  }

  const parsed = plugin.optionsSchema.safeParse(
    value.options === undefined ? emptyOptions : value.options,
  );
  if (!parsed.success) {
    addZodIssues(issues, [...path, "options"], parsed.error);
    return undefined;
  }

  return { kind: value.kind, options: parsed.data, plugin };
};

const readResolvedTarget = (
  context: ReadResolvedTargetContext,
):
  | X2ZodResolvedTarget<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>
  | undefined => {
  const { codeQuality, issues, name, plugins, value } = context;
  const path = ["targets", name] as const;
  const parsed = targetConfigSchema.safeParse(value);

  if (!parsed.success) {
    addZodIssues(issues, path, parsed.error);
    return undefined;
  }

  const { input, kind, options, output } = parsed.data;
  const plugin = plugins[kind];
  if (plugin === undefined) {
    issues.push(createIssue([...path, "kind"], `unknown plugin kind ${kind}`));
    return undefined;
  }

  const resolvedOutput = readResolvedOutput({
    codeQuality,
    issues,
    output,
    path: [...path, "output"],
  });
  const resolvedOptions = readPluginOptions({
    issues,
    path: [...path, "options"],
    plugin,
    value: options,
  });
  if (resolvedOutput === undefined || resolvedOptions === undefined) return undefined;

  return { input, kind, name, options: resolvedOptions, output: resolvedOutput, plugin };
};

const readResolvedTargets = ({
  codeQuality,
  issues,
  plugins,
  value,
}: ReadResolvedTargetsContext): X2ZodResolvedTargetMap<
  X2ZodLoadedInputPluginRegistry,
  X2ZodLoadedCodeQualityRegistry
> => {
  if (!isRecord(value)) {
    issues.push(createIssue(["targets"], "expected a target map object"));
    return {};
  }

  const targets: Record<
    string,
    X2ZodResolvedTarget<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>
  > = {};

  for (const [name, targetValue] of Object.entries(value))
    if (name.length === 0)
      issues.push(createIssue(["targets", name], "target names must not be empty"));
    else {
      const target = readResolvedTarget({ codeQuality, issues, name, plugins, value: targetValue });
      if (target !== undefined) targets[name] = target;
    }

  return targets;
};

const resolveUnknownX2ZodConfig = <
  const TPlugins extends X2ZodInputPluginRegistry,
  const TCodeQuality extends X2ZodCodeQualityRegistry,
>(
  value: unknown,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedConfig<TPlugins, TCodeQuality> => {
  const config = readConfigRecord(value);
  const issues: X2ZodConfigIssue[] = [];
  const plugins = readPluginConfig(config["plugins"], issues);
  const targets = readResolvedTargets({
    codeQuality: plugins.codeQuality,
    issues,
    plugins: plugins.input,
    value: config["targets"],
  });

  assertNoIssues(issues);

  return {
    configFile: options.configFile,
    plugins: {
      codeQuality: plugins.codeQuality as unknown as TCodeQuality,
      input: plugins.input as unknown as TPlugins,
    },
    targets: targets as unknown as X2ZodResolvedTargetMap<TPlugins, TCodeQuality>,
  };
};

const resolveUnknownX2ZodInputPluginRegistry = (
  value: unknown,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> => {
  const config = readConfigRecord(value);
  const issues: X2ZodConfigIssue[] = [];
  const plugins = readPluginConfig(config["plugins"], issues).input;

  assertNoIssues(issues);

  return { configFile: options.configFile, plugins };
};

export const resolveX2ZodConfig = <
  const TPlugins extends X2ZodInputPluginRegistry,
  const TCodeQuality extends X2ZodCodeQualityRegistry,
>(
  config: X2ZodConfig<TPlugins, TCodeQuality>,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedConfig<TPlugins, TCodeQuality> =>
  resolveUnknownX2ZodConfig<TPlugins, TCodeQuality>(config, options);

export const resolveX2ZodInputPluginRegistry = <const TPlugins extends X2ZodInputPluginRegistry>(
  config: Readonly<{
    plugins: Readonly<{ input: TPlugins & X2ZodInputPluginRegistryFor<TPlugins> }>;
  }>,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedInputPluginRegistry<TPlugins> =>
  resolveUnknownX2ZodInputPluginRegistry(
    config,
    options,
  ) as unknown as X2ZodResolvedInputPluginRegistry<TPlugins>;

export const loadX2ZodConfig = async (
  options: LoadX2ZodConfigOptions = {},
): Promise<X2ZodResolvedConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>> => {
  const configFileRequired = options.configFileRequired ?? true;
  const loaded = await loadC12Config<Record<string, unknown>>(
    c12LoadOptions(options, configFileRequired),
  );
  if (configFileRequired) assertRequiredConfigLoaded(loaded.config, resolvedConfigFile(loaded));

  return resolveUnknownX2ZodConfig<X2ZodLoadedInputPluginRegistry, X2ZodLoadedCodeQualityRegistry>(
    loaded.config,
    { configFile: loaded.configFile },
  );
};

export const loadX2ZodInputPluginRegistry = async (
  options: LoadX2ZodConfigOptions = {},
): Promise<X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> | undefined> => {
  const configFileRequired = options.configFileRequired ?? true;
  const loaded = await loadC12Config<Record<string, unknown>>(
    c12LoadOptions(options, configFileRequired),
  );
  if (!hasLoadedConfig(loaded.config, resolvedConfigFile(loaded))) {
    if (configFileRequired) assertRequiredConfigLoaded(loaded.config, resolvedConfigFile(loaded));
    return undefined;
  }

  return resolveUnknownX2ZodInputPluginRegistry(loaded.config, { configFile: loaded.configFile });
};
