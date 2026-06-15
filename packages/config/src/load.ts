import { declarationExportModeSchema, resolveZodSourceOutputOptions } from "@x2zod/core";
import { loadConfig as loadC12Config } from "c12";
import type { LoadConfigOptions } from "c12";
import type { z } from "zod/v4";
import { z as zod } from "zod/v4";

import { X2ZodConfigError } from "./errors";
import type { X2ZodConfigIssue, X2ZodConfigPathSegment } from "./errors";
import { isRecord } from "./structural";
import type { UnknownRecord } from "./structural";
import type {
  LoadX2ZodConfigOptions,
  ResolveX2ZodConfigOptions,
  X2ZodConfig,
  X2ZodInputConfig,
  X2ZodLoadedConfigPlugin,
  X2ZodLoadedPluginRegistry,
  X2ZodOutputConfig,
  X2ZodPluginRegistry,
  X2ZodPluginRegistryFor,
  X2ZodResolvedConfig,
  X2ZodResolvedOutputConfig,
  X2ZodResolvedPluginRegistry,
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

const outputConfigSchema: z.ZodType<X2ZodOutputConfig, X2ZodOutputConfig> = zod
  .strictObject({
    declarationExportMode: declarationExportModeSchema.optional(),
    path: nonEmptyStringSchema,
    typeName: nonEmptyStringSchema,
    zodImportPath: nonEmptyStringSchema.optional(),
  })
  .readonly();

const targetConfigSchema: z.ZodType<
  X2ZodTarget<X2ZodLoadedPluginRegistry>,
  X2ZodTarget<X2ZodLoadedPluginRegistry>
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
  plugin: X2ZodLoadedConfigPlugin;
  value: unknown;
}>;

type ReadResolvedTargetContext = Readonly<{
  issues: X2ZodConfigIssue[];
  name: string;
  plugins: X2ZodLoadedPluginRegistry;
  value: unknown;
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
  if (options.overrides !== undefined)
    loadOptions.overrides = options.overrides as Record<string, unknown>;

  return loadOptions;
};

const readConfigRecord = (value: unknown): UnknownRecord => {
  if (isRecord(value)) return value;
  throw new X2ZodConfigError([createIssue([], "expected a config object")]);
};

const readPluginRegistry = (
  value: unknown,
  issues: X2ZodConfigIssue[],
): X2ZodLoadedPluginRegistry => {
  if (!isRecord(value)) {
    issues.push(createIssue(["plugins"], "expected a plugin registry object"));
    return {};
  }

  const plugins: Record<string, X2ZodLoadedConfigPlugin> = {};

  for (const [key, pluginValue] of Object.entries(value)) {
    const plugin = readPluginRegistryEntry(key, pluginValue, issues);
    if (plugin !== undefined) plugins[key] = plugin;
  }

  return plugins;
};

const readPluginRegistryEntry = (
  key: string,
  value: unknown,
  issues: X2ZodConfigIssue[],
): X2ZodLoadedConfigPlugin | undefined => {
  const path = ["plugins", key] as const;
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
    ? (value as unknown as X2ZodLoadedConfigPlugin)
    : undefined;
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

const readResolvedOutput = (
  output: X2ZodOutputConfig,
  path: readonly X2ZodConfigPathSegment[],
  issues: X2ZodConfigIssue[],
): X2ZodResolvedOutputConfig | undefined => {
  const { path: outputPath, ...sourceOutputOptions } = output;
  const resolved = resolveZodSourceOutputOptions(sourceOutputOptions);
  if (!resolved.ok) {
    for (const diagnostic of resolved.diagnostics)
      issues.push(createIssue(path, diagnostic.message));
    return undefined;
  }

  return { ...resolved.value, path: outputPath };
};

const readPluginOptions = (context: ReadPluginOptionsContext): unknown => {
  const { issues, path, plugin, value } = context;
  const parsed = plugin.optionsSchema.safeParse(value === undefined ? emptyOptions : value);
  if (parsed.success) return parsed.data;

  addZodIssues(issues, path, parsed.error);
  return undefined;
};

const readResolvedTarget = (
  context: ReadResolvedTargetContext,
): X2ZodResolvedTarget<X2ZodLoadedPluginRegistry> | undefined => {
  const { issues, name, plugins, value } = context;
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

  const resolvedOutput = readResolvedOutput(output, [...path, "output"], issues);
  const resolvedOptions = readPluginOptions({
    issues,
    path: [...path, "options"],
    plugin,
    value: options,
  });
  if (resolvedOutput === undefined || resolvedOptions === undefined) return undefined;

  return { input, kind, name, options: resolvedOptions, output: resolvedOutput, plugin };
};

const readResolvedTargets = (
  value: unknown,
  plugins: X2ZodLoadedPluginRegistry,
  issues: X2ZodConfigIssue[],
): X2ZodResolvedTargetMap<X2ZodLoadedPluginRegistry> => {
  if (!isRecord(value)) {
    issues.push(createIssue(["targets"], "expected a target map object"));
    return {};
  }

  const targets: Record<string, X2ZodResolvedTarget<X2ZodLoadedPluginRegistry>> = {};

  for (const [name, targetValue] of Object.entries(value))
    if (name.length === 0)
      issues.push(createIssue(["targets", name], "target names must not be empty"));
    else {
      const target = readResolvedTarget({ issues, name, plugins, value: targetValue });
      if (target !== undefined) targets[name] = target;
    }

  return targets;
};

const resolveUnknownX2ZodConfig = <const TPlugins extends X2ZodPluginRegistry>(
  value: unknown,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedConfig<TPlugins> => {
  const config = readConfigRecord(value);
  const issues: X2ZodConfigIssue[] = [];
  const plugins = readPluginRegistry(config["plugins"], issues);
  const targets = readResolvedTargets(config["targets"], plugins, issues);

  assertNoIssues(issues);

  return {
    configFile: options.configFile,
    plugins: plugins as unknown as TPlugins,
    targets: targets as unknown as X2ZodResolvedTargetMap<TPlugins>,
  };
};

const resolveUnknownX2ZodPluginRegistry = (
  value: unknown,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> => {
  const config = readConfigRecord(value);
  const issues: X2ZodConfigIssue[] = [];
  const plugins = readPluginRegistry(config["plugins"], issues);

  assertNoIssues(issues);

  return { configFile: options.configFile, plugins };
};

export const resolveX2ZodConfig = <const TPlugins extends X2ZodPluginRegistry>(
  config: X2ZodConfig<TPlugins>,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedConfig<TPlugins> => resolveUnknownX2ZodConfig<TPlugins>(config, options);

export const resolveX2ZodPluginRegistry = <const TPlugins extends X2ZodPluginRegistry>(
  config: Readonly<{ plugins: TPlugins & X2ZodPluginRegistryFor<TPlugins> }>,
  options: ResolveX2ZodConfigOptions = {},
): X2ZodResolvedPluginRegistry<TPlugins> =>
  resolveUnknownX2ZodPluginRegistry(
    config,
    options,
  ) as unknown as X2ZodResolvedPluginRegistry<TPlugins>;

export const loadX2ZodConfig = async (
  options: LoadX2ZodConfigOptions = {},
): Promise<X2ZodResolvedConfig<X2ZodLoadedPluginRegistry>> => {
  const configFileRequired = options.configFileRequired ?? true;
  const loaded = await loadC12Config<Record<string, unknown>>(
    c12LoadOptions(options, configFileRequired),
  );
  if (configFileRequired) assertRequiredConfigLoaded(loaded.config, resolvedConfigFile(loaded));

  return resolveUnknownX2ZodConfig<X2ZodLoadedPluginRegistry>(loaded.config, {
    configFile: loaded.configFile,
  });
};

export const loadX2ZodPluginRegistry = async (
  options: LoadX2ZodConfigOptions = {},
): Promise<X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> | undefined> => {
  const configFileRequired = options.configFileRequired ?? true;
  const loaded = await loadC12Config<Record<string, unknown>>(
    c12LoadOptions(options, configFileRequired),
  );
  if (!hasLoadedConfig(loaded.config, resolvedConfigFile(loaded))) {
    if (configFileRequired) assertRequiredConfigLoaded(loaded.config, resolvedConfigFile(loaded));
    return undefined;
  }

  return resolveUnknownX2ZodPluginRegistry(loaded.config, { configFile: loaded.configFile });
};
