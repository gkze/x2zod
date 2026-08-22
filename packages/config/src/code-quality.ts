import { constants as bufferConstants } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z as zod } from "zod/v4";
import type { z } from "zod/v4";

import type { X2ZodOutputProcessorContext } from "./types";

export type X2ZodCodeQualityToolConfig<TConfig> =
  | Readonly<{ kind: "auto" }>
  | Readonly<{ kind: "inline"; value: TConfig }>
  | Readonly<{ kind: "path"; path: string }>;

export type X2ZodCodeQualityToolConfigInput<TConfig> = X2ZodCodeQualityToolConfig<TConfig>;

export type CommandResult = Readonly<{ exitCode: number; stderr: string; stdout: string }>;

export type RunCommandOptions = Readonly<{ cwd: string; input?: string | undefined }>;

export type ConfigPathForRequest<TConfig> = Readonly<{
  config: X2ZodCodeQualityToolConfig<TConfig>;
  context: X2ZodOutputProcessorContext;
  tempDirectory: string;
  toolName: string;
}>;

const commandMaxBufferBytes = bufferConstants.MAX_LENGTH;

const textFromCommandOutput = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
};

export const runCommand = (
  command: string,
  args: readonly string[],
  options: RunCommandOptions,
): CommandResult => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: commandMaxBufferBytes,
  });
  if (result.error !== undefined) throw result.error;
  return {
    exitCode: result.status ?? 1,
    stderr: textFromCommandOutput(result.stderr),
    stdout: textFromCommandOutput(result.stdout),
  };
};

export const outputDirectory = (context: X2ZodOutputProcessorContext): string =>
  context.outputPath === undefined ? os.tmpdir() : path.dirname(context.outputPath);

export const outputFileName = (context: X2ZodOutputProcessorContext): string =>
  context.outputPath === undefined ? "generated.ts" : path.basename(context.outputPath);

export const resolveConfigPath = (
  context: X2ZodOutputProcessorContext,
  configPath: string,
): string =>
  path.isAbsolute(configPath) ? configPath : path.join(context.baseDirectory, configPath);

export const codeQualityToolConfigSchema = <TConfig>(): z.ZodType<
  X2ZodCodeQualityToolConfig<TConfig>,
  X2ZodCodeQualityToolConfigInput<TConfig>
> =>
  zod
    .discriminatedUnion("kind", [
      zod.strictObject({ kind: zod.literal("auto") }).readonly(),
      zod.strictObject({ kind: zod.literal("inline"), value: zod.custom<TConfig>() }).readonly(),
      zod.strictObject({ kind: zod.literal("path"), path: zod.string().min(1) }).readonly(),
    ])
    .readonly();

export const configPathFor = async <TConfig>({
  config,
  context,
  tempDirectory,
  toolName,
}: ConfigPathForRequest<TConfig>): Promise<string | undefined> => {
  if (config.kind === "auto") return undefined;
  if (config.kind === "path") return resolveConfigPath(context, config.path);

  const configPath = path.join(tempDirectory, `${toolName}.config.json`);
  await mkdir(tempDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config.value, undefined, 2)}\n`);
  return configPath;
};
