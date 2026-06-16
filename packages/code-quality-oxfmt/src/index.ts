import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import {
  codeQualityToolConfigSchema,
  configPathFor,
  outputDirectory,
  outputFileName,
  runCommand,
} from "@x2zod/config";
import type {
  X2ZodCodeQualityContext,
  X2ZodCodeQualityPlugin,
  X2ZodCodeQualityToolConfig,
} from "@x2zod/config";
import type { OxfmtConfig } from "oxfmt";
import type { z } from "zod/v4";
import { z as zod } from "zod/v4";

export type { OxfmtConfig } from "oxfmt";

export type OxfmtCodeQualityOptions = Readonly<{
  command: string;
  config: X2ZodCodeQualityToolConfig<OxfmtConfig>;
}>;

export type OxfmtCodeQualityOptionsInput = Readonly<{
  command?: string | undefined;
  config?: X2ZodCodeQualityToolConfig<OxfmtConfig> | undefined;
}>;

const oxfmtCodeQualityOptionsSchemaValue: z.ZodType<
  OxfmtCodeQualityOptions,
  OxfmtCodeQualityOptionsInput
> = zod
  .strictObject({
    command: zod.string().min(1).default("oxfmt"),
    config: codeQualityToolConfigSchema<OxfmtConfig>().default({ kind: "auto" }),
  })
  .readonly();

const oxfmtArgs = (context: X2ZodCodeQualityContext, configPath?: string): string[] => [
  "--stdin-filepath",
  context.outputPath ?? outputFileName(context),
  ...(configPath === undefined ? [] : ["--config", configPath]),
];

const oxfmtFailureMessage = (result: Readonly<{ stderr: string; stdout: string }>): string =>
  result.stderr.trim() || result.stdout.trim() || "oxfmt failed";

const runOxfmt = async (
  sourceText: string,
  options: OxfmtCodeQualityOptions,
  context: X2ZodCodeQualityContext,
): Promise<string> => {
  const tempParent = outputDirectory(context);
  await mkdir(tempParent, { recursive: true });
  const tempDirectory = await mkdtemp(path.join(tempParent, ".x2zod-oxfmt-"));

  try {
    const configPath = await configPathFor({
      config: options.config,
      context,
      tempDirectory,
      toolName: "oxfmt",
    });
    const result = runCommand(options.command, oxfmtArgs(context, configPath), {
      cwd: context.baseDirectory,
      input: sourceText,
    });
    if (result.exitCode !== 0) throw new Error(oxfmtFailureMessage(result));
    return result.stdout;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
};

export const oxfmtCodeQualityOptionsSchema: z.ZodType<
  OxfmtCodeQualityOptions,
  OxfmtCodeQualityOptionsInput
> = oxfmtCodeQualityOptionsSchemaValue;

export const oxfmtCodeQualityPlugin: X2ZodCodeQualityPlugin<
  OxfmtCodeQualityOptions,
  OxfmtCodeQualityOptionsInput,
  "oxfmt"
> = { kind: "oxfmt", optionsSchema: oxfmtCodeQualityOptionsSchemaValue, transform: runOxfmt };
