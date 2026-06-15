#!/usr/bin/env bun

import process from "node:process";

import {
  choice,
  command,
  constant,
  conditional,
  map,
  message,
  object,
  option,
  optional,
  or,
  runParserSync,
  string,
  withDefault,
} from "@optique/core";
import type { Parser, RunOptions } from "@optique/core";
import { loadX2ZodPluginRegistry } from "@x2zod/config";
import type { X2ZodLoadedPluginRegistry, X2ZodResolvedPluginRegistry } from "@x2zod/config";

import { compileFromCLI, runConfiguredTargets } from "./compile";
import type { CLIWriter, CompileTargetOverrides } from "./compile";
import { zodObjectToOptiqueOverrides } from "./zod-to-optique";

type RunCommand = Readonly<{ configFile?: string | undefined; mode: "run" }>;
type CompileCommand = CompileTargetOverrides & Readonly<{ mode: "compile" }>;
type ParsedCommand = CompileCommand | RunCommand;
type ParserExit = Readonly<{ exitCode: number; mode: "completion" | "help" | "parse-error" }>;
type PluginKind = string;
type CommandParser = Parser<"sync", ParsedCommand>;
type PluginOptionsParser = Parser<"sync", Readonly<Record<string, unknown>>>;
type PluginSelection = readonly [string | undefined, Readonly<Record<string, unknown>>];
type CompileBootstrapOptions = Readonly<{
  configFile?: string | undefined;
  kind?: string | undefined;
}>;
type ParsedCommandContext = Readonly<{
  commandResult: ParsedCommand | ParserExit;
  mode: "parsed";
  pluginRegistry?: X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> | undefined;
}>;
type ParserSetupFailure = Readonly<{ exitCode: number; mode: "setup-error" }>;
type ParsedCommandContextResult = ParsedCommandContext | ParserSetupFailure;

export type RunCLIOptions = Readonly<{
  cwd?: string | undefined;
  stderr?: CLIWriter | undefined;
  stdout?: CLIWriter | undefined;
}>;

const programName = "x2zod";
const completionCommandName = "completion";
const completionOptionName = "--completion";
const defaultInlineId = "inline";
const missingOptionIndex = -1;
const successExitCode = 0;
const currentModulePath = import.meta.filename;

const cliArgs = (): readonly string[] => process.argv.slice(2);

const defaultStdout: CLIWriter = (text): void => {
  process.stdout.write(text);
};

const defaultStderr: CLIWriter = (text): void => {
  process.stderr.write(text);
};

const writeWithTrailingNewline =
  (write: CLIWriter): CLIWriter =>
  (text) => {
    write([text, "\n"].join(""));
  };

const configFileOption = optional(
  option("-c", "--config", string({ metavar: "FILE" }), {
    description: message`Configuration file path.`,
  }),
);
const emptyOptionsParser = constant({} as const) as PluginOptionsParser;

const createCompileParser = (plugins: X2ZodLoadedPluginRegistry): Parser<"sync", CompileCommand> =>
  command(
    "compile",
    map(
      object({
        configFile: configFileOption,
        declarationExportMode: optional(
          option("-e", "--declaration-export-mode", choice(["all", "root"]), {
            description: message`Declaration export mode.`,
          }),
        ),
        inlineId: withDefault(
          option("-I", "--inline-id", string({ metavar: "ID" }), {
            description: message`Inline input identifier.`,
          }),
          defaultInlineId,
        ),
        inlineText: optional(
          option("-x", "--text", string({ metavar: "TEXT" }), {
            description: message`Inline schema text.`,
          }),
        ),
        inputPath: optional(
          option("-i", "--input", string({ metavar: "FILE" }), {
            description: message`Input schema file path.`,
          }),
        ),
        mediaType: optional(
          option("-m", "--media-type", string({ metavar: "TYPE" }), {
            description: message`Input document media type.`,
          }),
        ),
        outputPath: optional(
          option("-o", "--output", string({ metavar: "FILE" }), {
            description: message`Output TypeScript file path, or - for stdout.`,
          }),
        ),
        pluginSelection: pluginSelectionParser(plugins),
        targetName: optional(
          option("-g", "--target", string({ metavar: "NAME" }), {
            description: message`Configured target name.`,
          }),
        ),
        typeName: optional(
          option("-n", "--type-name", string({ metavar: "NAME" }), {
            description: message`Generated root TypeScript type name.`,
          }),
        ),
        uri: optional(
          option("-r", "--uri", string({ metavar: "URI" }), {
            description: message`Input schema URI.`,
          }),
        ),
        zodImportPath: optional(
          option("-z", "--zod-import-path", string({ metavar: "SPECIFIER" }), {
            description: message`Zod import specifier for generated source.`,
          }),
        ),
      }),
      ({ pluginSelection, ...options }): CompileCommand => {
        const [kind, pluginOptions] = pluginSelection;
        return { ...options, kind, mode: "compile", pluginOptions };
      },
    ),
    { brief: message`Compile one schema input into Zod TypeScript source.` },
  );

const runParser = command(
  "run",
  map(
    object({ configFile: configFileOption }),
    (options): RunCommand => ({ ...options, mode: "run" }),
  ),
  { brief: message`Run every configured target.` },
);

const pluginKindChoices = (
  plugins: X2ZodLoadedPluginRegistry,
): readonly [PluginKind, ...PluginKind[]] | undefined => {
  const kinds = Object.keys(plugins);
  if (kinds.length === 0) return undefined;
  return kinds as unknown as readonly [PluginKind, ...PluginKind[]];
};

const genericPluginSelectionParser = (): Parser<"sync", PluginSelection> =>
  map(
    optional(
      option("-k", "--kind", string({ metavar: "KIND" }), {
        description: message`Input plugin kind.`,
      }),
    ),
    (kind): PluginSelection => [kind, {}],
  );

const pluginOptionBranches = (
  plugins: X2ZodLoadedPluginRegistry,
): Record<string, PluginOptionsParser> =>
  Object.fromEntries(
    Object.entries(plugins).map(([kind, plugin]) => [
      kind,
      zodObjectToOptiqueOverrides(plugin.optionsSchema),
    ]),
  );

const pluginSelectionParser = (
  plugins: X2ZodLoadedPluginRegistry,
): Parser<"sync", PluginSelection> => {
  const choices = pluginKindChoices(plugins);
  if (choices === undefined) return genericPluginSelectionParser();

  return conditional(
    option("-k", "--kind", choice(choices), { description: message`Input plugin kind.` }),
    pluginOptionBranches(plugins),
    emptyOptionsParser,
  ) as Parser<"sync", PluginSelection>;
};

const createCommandParser = (
  pluginRegistry: X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> | undefined,
): CommandParser => {
  const compileParser = createCompileParser(pluginRegistry?.plugins ?? {});
  return or(compileParser, runParser);
};

const runOptions = (options: RunCLIOptions): RunOptions<ParserExit, ParserExit> => ({
  aboveError: "usage",
  help: {
    onShow: (exitCode): ParserExit => ({ exitCode, mode: "help" }),
    option: { names: ["-h", "--help"] },
  },
  completion: {
    command: { names: [completionCommandName] },
    onShow: (exitCode): ParserExit => ({ exitCode, mode: "completion" }),
    option: { names: [completionOptionName] },
  },
  onError: (exitCode): ParserExit => ({ exitCode, mode: "parse-error" }),
  showChoices: true,
  showDefault: true,
  stderr: writeWithTrailingNewline(options.stderr ?? defaultStderr),
  stdout: writeWithTrailingNewline(options.stdout ?? defaultStdout),
});

const parseCommand = (
  argv: readonly string[],
  options: RunCLIOptions,
  pluginRegistry: X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> | undefined,
): ParsedCommand | ParserExit =>
  runParserSync(createCommandParser(pluginRegistry), programName, argv, runOptions(options)) as
    | ParsedCommand
    | ParserExit;

const compileBootstrapOptions = (argv: readonly string[]): CompileBootstrapOptions => {
  if (argv[0] !== "compile") return {};

  let configFile: string | undefined = undefined;
  let kind: string | undefined = undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === "--") break;
    if (token === "-c" || token === "--config") {
      configFile = optionArgument(argv, index);
      if (configFile !== undefined) index += 1;
    } else if (token.startsWith("--config=")) configFile = token.slice("--config=".length);
    else if (token === "-k" || token === "--kind") {
      kind = optionArgument(argv, index);
      if (kind !== undefined) index += 1;
    } else if (token.startsWith("--kind=")) kind = token.slice("--kind=".length);
  }

  return { configFile, kind };
};

const optionArgument = (argv: readonly string[], optionIndex: number): string | undefined => {
  const value = argv[optionIndex + 1];
  return value === undefined || value.startsWith("-") ? undefined : value;
};

const loadPluginRegistryForArgv = async (
  argv: readonly string[],
  cwd: string,
): Promise<X2ZodResolvedPluginRegistry<X2ZodLoadedPluginRegistry> | undefined> => {
  const registryArgv = pluginRegistryArgv(argv);
  if (registryArgv[0] !== "compile") return undefined;

  const bootstrap = compileBootstrapOptions(registryArgv);
  const pluginRegistry = await loadX2ZodPluginRegistry({
    configFile: bootstrap.configFile,
    configFileRequired: bootstrap.configFile !== undefined,
    cwd,
  });
  return pluginRegistry;
};

const pluginRegistryArgv = (argv: readonly string[]): readonly string[] => {
  if (argv[0] === completionCommandName) return argv.slice(2);

  const completionOptionIndex = argv.findIndex(
    (token) => token === completionOptionName || token.startsWith(`${completionOptionName}=`),
  );
  if (completionOptionIndex === missingOptionIndex) return argv;

  const shellOffset = argv[completionOptionIndex]?.includes("=") === true ? 1 : 2;
  return argv.slice(completionOptionIndex + shellOffset);
};

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown CLI failure.";

const writeCLIFailure = (options: RunCLIOptions, error: unknown): void => {
  (options.stderr ?? defaultStderr)(`${formatErrorMessage(error)}\n`);
};

const isParserExit = (value: ParsedCommand | ParserExit): value is ParserExit =>
  value.mode === "completion" || value.mode === "help" || value.mode === "parse-error";

const parseCommandContext = async (
  argv: readonly string[],
  cwd: string,
  options: RunCLIOptions,
): Promise<ParsedCommandContext> => {
  const pluginRegistry = await loadPluginRegistryForArgv(argv, cwd);
  return {
    commandResult: parseCommand(argv, options, pluginRegistry),
    mode: "parsed",
    pluginRegistry,
  };
};

const parseCommandContextResult = async (
  argv: readonly string[],
  cwd: string,
  options: RunCLIOptions,
): Promise<ParsedCommandContextResult> => {
  try {
    const parsedContext = await parseCommandContext(argv, cwd, options);
    return parsedContext;
  } catch (error) {
    writeCLIFailure(options, error);
    return { exitCode: 1, mode: "setup-error" };
  }
};

export const runCLI = async (
  argv: readonly string[] = cliArgs(),
  options: RunCLIOptions = {},
): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();

  if (argv.length === 0) {
    const exitCode = await runConfiguredTargets({ ...options, cwd });
    return exitCode;
  }

  const parsedContext = await parseCommandContextResult(argv, cwd, options);
  if (parsedContext.mode === "setup-error") return parsedContext.exitCode;
  const { commandResult, pluginRegistry } = parsedContext;
  if (isParserExit(commandResult)) return commandResult.exitCode;

  if (commandResult.mode === "run") {
    const exitCode = await runConfiguredTargets({
      ...options,
      configFile: commandResult.configFile,
      cwd,
    });
    return exitCode;
  }

  const exitCode = await compileFromCLI(commandResult, {
    ...options,
    configFile: commandResult.configFile,
    cwd,
    pluginRegistry,
  });
  return exitCode;
};

export const main = async (argv: readonly string[] = cliArgs()): Promise<void> => {
  const exitCode = await runCLI(argv);
  if (exitCode !== successExitCode) process.exitCode = exitCode;
};

if (process.argv[1] === currentModulePath) await main();
