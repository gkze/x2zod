import nodePath from "node:path";

import {
  applyX2ZodCodeQuality,
  compileX2ZodTarget,
  loadX2ZodConfig,
  loadX2ZodInputPluginRegistry,
  resolveX2ZodCompilableTarget,
} from "@x2zod/config";
import type {
  X2ZodCompilableTarget,
  X2ZodCompileTargetOverrides,
  X2ZodInputConfig,
  X2ZodLoadedInputPluginRegistry,
  X2ZodResolvedInputPluginRegistry,
  ZodCLIOptionTransformContext,
} from "@x2zod/config";
import { printSourceFile } from "@x2zod/core";
import type { Diagnostic, InputDocumentInput } from "@x2zod/core";

import { nodeTextFileSystem } from "./file-system";
import type { CLITextFileSystem } from "./file-system";

const outputToStdoutPath = "-";

export type CLIWriter = (text: string) => void;

export type CLIIO = Readonly<{
  fileSystem?: CLITextFileSystem | undefined;
  stderr?: CLIWriter | undefined;
  stdout?: CLIWriter | undefined;
}>;

export type CompileTargetOverrides = Readonly<{ configFile?: string | undefined }> &
  X2ZodCompileTargetOverrides;

export type RunConfiguredTargetsOptions = Readonly<{
  configFile?: string | undefined;
  cwd: string;
}> &
  CLIIO;

export type CompileFromCLIOptions = RunConfiguredTargetsOptions &
  Readonly<{
    pluginRegistry?: X2ZodResolvedInputPluginRegistry<X2ZodLoadedInputPluginRegistry> | undefined;
  }>;

type CompileContext = Readonly<{
  baseDirectory: string;
  cwd: string;
  fileSystem: CLITextFileSystem;
  stderr: CLIWriter;
  stdout: CLIWriter;
}>;

type CompileTargetRequest = Readonly<{
  context: CompileContext;
  pluginOptions: unknown;
  target: X2ZodCompilableTarget;
}>;

type OutputPathConfig = Readonly<{ path: string }>;

class CLICompileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CLICompileError";
  }
}

const defaultStdout: CLIWriter = (text) => {
  process.stdout.write(text);
};

const defaultStderr: CLIWriter = (text) => {
  process.stderr.write(text);
};

const createCompileContext = (
  cwd: string,
  baseDirectory: string,
  io: CLIIO = {},
): CompileContext => ({
  baseDirectory,
  cwd,
  fileSystem: io.fileSystem ?? nodeTextFileSystem,
  stderr: io.stderr ?? defaultStderr,
  stdout: io.stdout ?? defaultStdout,
});

const resolvePath = (baseDirectory: string, filePath: string): string =>
  nodePath.isAbsolute(filePath) ? filePath : nodePath.join(baseDirectory, filePath);

const outputPathFor = (output: OutputPathConfig, context: CompileContext): string | undefined =>
  output.path === outputToStdoutPath ? undefined : resolvePath(context.baseDirectory, output.path);

const configBaseDirectory = (cwd: string, configFile: string | undefined): string =>
  configFile === undefined ? cwd : nodePath.dirname(configFile);

const withMediaType = <TValue extends object>(
  value: TValue,
  mediaType: string | undefined,
): TValue | (TValue & Readonly<{ mediaType: string }>) =>
  mediaType === undefined ? value : { ...value, mediaType };

const documentForInput = async (
  input: X2ZodInputConfig,
  context: CompileContext,
): Promise<InputDocumentInput> => {
  if ("path" in input) {
    const filePath = resolvePath(context.baseDirectory, input.path);
    return withMediaType(
      {
        source: { kind: "file", path: filePath },
        text: await context.fileSystem.readTextFile(filePath),
      },
      input.mediaType,
    );
  }

  if ("uri" in input) {
    const response = await fetch(input.uri);
    if (!response.ok)
      throw new CLICompileError(
        `Failed to fetch ${input.uri}: HTTP ${response.status.toString()}.`,
      );
    const responseMediaType = response.headers.get("content-type")?.split(";")[0];
    return withMediaType(
      { source: { kind: "uri", uri: input.uri }, text: await response.text() },
      input.mediaType ?? responseMediaType,
    );
  }

  return withMediaType(
    { source: { id: input.id, kind: "inline" }, text: input.text },
    input.mediaType,
  );
};

const formatDiagnostics = (diagnostics: readonly Diagnostic[]): string =>
  diagnostics
    .map((diagnostic): string => [diagnostic.code, diagnostic.message].join(": "))
    .join("\n");

const formatErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown compile failure.";

const writeCLIFailure = (io: CLIIO, error: unknown): void => {
  (io.stderr ?? defaultStderr)(`${formatErrorMessage(error)}\n`);
};

const runCLITask = async (io: CLIIO, run: () => Promise<number>): Promise<number> => {
  try {
    const exitCode = await run();
    return exitCode;
  } catch (error) {
    writeCLIFailure(io, error);
    return 1;
  }
};

const writeGeneratedSource = async (
  output: OutputPathConfig,
  sourceText: string,
  context: CompileContext,
): Promise<void> => {
  const outputPath = outputPathFor(output, context);
  if (outputPath === undefined) {
    context.stdout(sourceText);
    return;
  }

  await context.fileSystem.makeDirectory(nodePath.dirname(outputPath), { recursive: true });
  await context.fileSystem.writeTextFile(outputPath, sourceText);
};

const optionTransformContext = (context: CompileContext): ZodCLIOptionTransformContext => ({
  baseDirectory: context.baseDirectory,
  readTextFile: context.fileSystem.readTextFile,
});

const compileTarget = async ({
  context,
  pluginOptions,
  target,
}: CompileTargetRequest): Promise<void> => {
  const result = await compileX2ZodTarget({
    loadInputDocument: async (input) => {
      const document = await documentForInput(input, context);
      return document;
    },
    pluginOptions,
    target,
  });

  if (!result.ok) throw new CLICompileError(formatDiagnostics(result.diagnostics));

  const sourceText = await printSourceFile(result.value.sourceFile, { cwd: context.cwd });
  const qualitySourceText = await applyX2ZodCodeQuality({
    context: {
      baseDirectory: context.baseDirectory,
      outputPath: outputPathFor(target.output, context),
    },
    output: target.output,
    sourceText,
  });

  await writeGeneratedSource(target.output, qualitySourceText, context);
};

export const compileFromCLI = async (
  overrides: CompileTargetOverrides,
  options: CompileFromCLIOptions,
): Promise<number> => {
  const exitCode = await runCLITask(options, async () => {
    const config =
      overrides.targetName === undefined
        ? undefined
        : await loadX2ZodConfig({ configFile: overrides.configFile, cwd: options.cwd });
    const pluginRegistry =
      config === undefined
        ? (options.pluginRegistry ??
          (await loadX2ZodInputPluginRegistry({
            configFile: overrides.configFile,
            cwd: options.cwd,
          })))
        : undefined;
    const context = createCompileContext(
      options.cwd,
      config === undefined ? options.cwd : configBaseDirectory(options.cwd, config.configFile),
      options,
    );

    const { pluginOptions, target } = await resolveX2ZodCompilableTarget({
      config,
      optionTransformContext: optionTransformContext(context),
      overrides,
      pluginRegistry,
    });
    await compileTarget({ context, pluginOptions, target });
    return 0;
  });
  return exitCode;
};

export const runConfiguredTargets = async (
  options: RunConfiguredTargetsOptions,
): Promise<number> => {
  const exitCode = await runCLITask(options, async () => {
    const config = await loadX2ZodConfig({ configFile: options.configFile, cwd: options.cwd });
    const context = createCompileContext(
      options.cwd,
      configBaseDirectory(options.cwd, config.configFile),
      options,
    );
    const results = await Promise.all(
      Object.values(config.targets).map(async (target): Promise<number> => {
        try {
          await compileTarget({ context, pluginOptions: target.options, target });
          return 0;
        } catch (error) {
          context.stderr(`${target.name}: ${formatErrorMessage(error)}\n`);
          return 1;
        }
      }),
    );

    const failures = results.reduce((total, result) => total + result, 0);
    return failures === 0 ? 0 : 1;
  });
  return exitCode;
};
