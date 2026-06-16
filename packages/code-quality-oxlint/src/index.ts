import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  codeQualityToolConfigSchema,
  configPathFor,
  outputDirectory,
  outputFileName,
  runCommand,
} from "@x2zod/config";
import type {
  CommandResult,
  X2ZodCodeQualityContext,
  X2ZodCodeQualityPlugin,
  X2ZodCodeQualityToolConfig,
} from "@x2zod/config";
import type { OxlintConfig } from "oxlint";
import type { z } from "zod/v4";
import { z as zod } from "zod/v4";

export type { OxlintConfig } from "oxlint";

export type OxlintCodeQualityOptions = Readonly<{
  command: string;
  config: X2ZodCodeQualityToolConfig<OxlintConfig>;
  fix: boolean;
}>;

export type OxlintCodeQualityOptionsInput = Readonly<{
  command?: string | undefined;
  config?: X2ZodCodeQualityToolConfig<OxlintConfig> | undefined;
  fix?: boolean | undefined;
}>;

const oxlintCodeQualityOptionsSchemaValue: z.ZodType<
  OxlintCodeQualityOptions,
  OxlintCodeQualityOptionsInput
> = zod
  .strictObject({
    command: zod.string().min(1).default("oxlint"),
    config: codeQualityToolConfigSchema<OxlintConfig>().default({ kind: "auto" }),
    fix: zod.boolean().default(true),
  })
  .readonly();

const oxlintArgs = (
  filePath: string,
  options: OxlintCodeQualityOptions,
  configPath?: string,
): string[] => [
  ...(options.fix ? ["--fix"] : []),
  "--format",
  "json",
  ...(configPath === undefined ? [] : ["--config", configPath]),
  filePath,
];

type OxlintDiagnostic = Readonly<{
  code?: string | undefined;
  filename?: string | undefined;
  labels?:
    | readonly Readonly<{
        span?: Readonly<{ column?: number | undefined; line?: number | undefined }> | undefined;
      }>[]
    | undefined;
  message?: string | undefined;
}>;

const isOxlintDiagnosticsPayload = (
  value: unknown,
): value is Readonly<{ diagnostics: readonly OxlintDiagnostic[] }> =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Readonly<{ diagnostics?: unknown }>).diagnostics);

const parseOxlintDiagnostics = (stdout: string): readonly OxlintDiagnostic[] => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isOxlintDiagnosticsPayload(parsed) ? parsed.diagnostics : [];
  } catch {
    return [];
  }
};

const formatOxlintDiagnostic = (diagnostic: OxlintDiagnostic): string => {
  const span = diagnostic.labels?.[0]?.span;
  const location =
    diagnostic.filename === undefined
      ? undefined
      : [diagnostic.filename, span?.line, span?.column]
          .filter((part) => part !== undefined)
          .join(":");
  return [location, diagnostic.code, diagnostic.message].filter(Boolean).join(" ");
};

const oxlintFailureMessage = (result: CommandResult): string => {
  const diagnostics = parseOxlintDiagnostics(result.stdout);
  if (diagnostics.length > 0)
    return diagnostics.map((diagnostic) => formatOxlintDiagnostic(diagnostic)).join("\n");
  return result.stderr.trim() || result.stdout.trim() || "oxlint failed";
};

const runOxlint = async (
  sourceText: string,
  options: OxlintCodeQualityOptions,
  context: X2ZodCodeQualityContext,
): Promise<string> => {
  const tempParent = outputDirectory(context);
  await mkdir(tempParent, { recursive: true });
  const tempDirectory = await mkdtemp(path.join(tempParent, ".x2zod-oxlint-"));
  const tempFile = path.join(tempDirectory, outputFileName(context));

  try {
    const configPath = await configPathFor({
      config: options.config,
      context,
      tempDirectory,
      toolName: "oxlint",
    });
    await writeFile(tempFile, sourceText);
    const result = runCommand(options.command, oxlintArgs(tempFile, options, configPath), {
      cwd: context.baseDirectory,
    });
    if (result.exitCode !== 0) throw new Error(oxlintFailureMessage(result));
    return await readFile(tempFile, "utf8");
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
};

export const oxlintCodeQualityOptionsSchema: z.ZodType<
  OxlintCodeQualityOptions,
  OxlintCodeQualityOptionsInput
> = oxlintCodeQualityOptionsSchemaValue;

export const oxlintCodeQualityPlugin: X2ZodCodeQualityPlugin<
  OxlintCodeQualityOptions,
  OxlintCodeQualityOptionsInput,
  "oxlint"
> = { kind: "oxlint", optionsSchema: oxlintCodeQualityOptionsSchemaValue, transform: runOxlint };
