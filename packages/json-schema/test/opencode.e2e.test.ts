import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod/v4";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isNativePreviewShutdownStderr,
  isRecord,
  nativePreviewExternals,
  outputText,
  runNode,
} from "../../../test/native-source-harness";
import type { JsonValue } from "../src";

const testDirectory = import.meta.dirname;
const packageRootDirectory = resolve(testDirectory, "..");
const repositoryRootDirectory = resolve(packageRootDirectory, "../..");
const tempRootDirectory = join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-opencode-e2e-";
const printerHelperEntryPoint = join(testDirectory, "opencode-print-helper.ts");
const bundledPrinterFileName = "opencode-print-helper.mjs";
const generatedModuleFileName = "opencode.generated.ts";
const generatedConfigFileName = "opencode.json";
const homeDirectoryName = "home";
const projectDirectoryName = "project";
const openCodeConfigSchemaFixture = join(testDirectory, "fixtures/opencode/config.schema.json");
const modelSchemaFixture = join(testDirectory, "fixtures/opencode/model-schema.json");
const openCodeBinaryName = process.platform === "win32" ? "opencode.cmd" : "opencode";
const openCodeConfigSchemaExport = "openCodeConfigSchema";
const openCodeSchemaUrl = "https://opencode.ai/config.json";
const openCodeTestHostname = "127.0.0.1";
const openCodeTestPort = 4099;
const openCodeTestUsername = "x2zod-e2e";
const openCodeSubprocessDeadlineMs = 4000;
const openCodeSubprocessTerminationGraceMs = 500;
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;
const sampleOpenCodeConfig = {
  $schema: openCodeSchemaUrl,
  logLevel: "DEBUG",
  server: { hostname: openCodeTestHostname, mdns: false, port: openCodeTestPort },
  username: openCodeTestUsername,
} as const satisfies JsonValue;
const openCodeDebugConfigSchema = z.looseObject({
  logLevel: z.literal(sampleOpenCodeConfig.logLevel),
  server: z.looseObject({
    hostname: z.literal(openCodeTestHostname),
    port: z.literal(openCodeTestPort),
  }),
  username: z.literal(openCodeTestUsername),
});

type GeneratedZodSchema = Readonly<{ parse: (value: unknown) => unknown }>;
type GeneratedOpenCodeConfigModule = Readonly<{ openCodeConfigSchema: GeneratedZodSchema }>;
type OpenCodeDebugConfig = z.infer<typeof openCodeDebugConfigSchema>;
type OpenCodeSubprocessExit = Readonly<{ exitCode: number; timedOut: boolean }>;
type AssertOpenCodeAcceptsConfigRequest = Readonly<{
  configDirectory: string;
  configFile: string;
  executable: string;
  homeDirectory: string;
  projectDirectory: string;
}>;

const buildPrinterBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: packageRootDirectory,
    entryPoint: printerHelperEntryPoint,
    externals: jsonSchemaNativePreviewExternals,
    outfile: bundleFile,
  });
};

const printGeneratedOpenCodeSource = (bundleFile: string): string =>
  runNode({
    allowedStderr: isNativePreviewShutdownStderr,
    args: [bundleFile, openCodeConfigSchemaFixture, modelSchemaFixture],
    cwd: packageRootDirectory,
  });

const isGeneratedZodSchema = (value: unknown): value is GeneratedZodSchema =>
  isRecord(value) && typeof value["parse"] === "function";

const importGeneratedOpenCodeModule = async (
  generatedModuleFile: string,
): Promise<GeneratedOpenCodeConfigModule> => ({
  openCodeConfigSchema: await importGeneratedExport(
    generatedModuleFile,
    openCodeConfigSchemaExport,
    isGeneratedZodSchema,
  ),
});

const openCodeBinaryCandidates = (): readonly string[] => {
  const pathCandidate = Bun.which("opencode");
  return [
    join(packageRootDirectory, "node_modules/.bin", openCodeBinaryName),
    join(repositoryRootDirectory, "node_modules/.bin", openCodeBinaryName),
    ...(pathCandidate === null ? [] : [pathCandidate]),
  ];
};

const openCodeExecutable = (): string => {
  const executable = openCodeBinaryCandidates().find((candidate) => existsSync(candidate));
  if (executable === undefined)
    throw new Error("Missing opencode executable. Run bun install before the E2E test.");
  return executable;
};

const currentProcessEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

const openCodeEnvironment = (
  homeDirectory: string,
  configFile: string,
  configDirectory: string,
): Record<string, string> => ({
  ...currentProcessEnvironment(),
  HOME: homeDirectory,
  NO_COLOR: "1",
  OPENCODE_CONFIG: configFile,
  OPENCODE_CONFIG_DIR: configDirectory,
  XDG_CACHE_HOME: join(homeDirectory, ".cache"),
  XDG_CONFIG_HOME: join(homeDirectory, ".config"),
  XDG_DATA_HOME: join(homeDirectory, ".local/share"),
  XDG_STATE_HOME: join(homeDirectory, ".local/state"),
});

const parseOpenCodeDebugConfigOutput = (stdout: Uint8Array): OpenCodeDebugConfig =>
  openCodeDebugConfigSchema.parse(JSON.parse(outputText(stdout)));

const readSubprocessOutput = async (
  output: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array> =>
  output === null ? new Uint8Array() : new Uint8Array(await new Response(output).arrayBuffer());

const formatSubprocessOutput = (name: string, value: Uint8Array): string => {
  const text = outputText(value);
  return text.length === 0 ? `${name}: <empty>` : `${name}:\n${text}`;
};

const openCodeSubprocessError = ({
  cmd,
  deadlineMs,
  exitCode,
  stderr,
  stdout,
  timedOut,
}: Readonly<{
  cmd: readonly string[];
  deadlineMs: number;
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
  timedOut: boolean;
}>): Error =>
  new Error(
    [
      timedOut
        ? `OpenCode subprocess did not exit before the ${deadlineMs.toString()}ms deadline.`
        : `OpenCode subprocess exited with code ${exitCode.toString()}.`,
      `Command: ${cmd.join(" ")}`,
      formatSubprocessOutput("stdout", stdout),
      formatSubprocessOutput("stderr", stderr),
    ].join("\n"),
  );

const runOpenCodeSubprocess = async ({
  cmd,
  cwd,
  env,
}: Readonly<{
  cmd: readonly [string, ...string[]];
  cwd: string;
  env: Record<string, string>;
}>): Promise<Uint8Array> => {
  const subprocess = Bun.spawn([...cmd], {
    cwd,
    env,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = readSubprocessOutput(subprocess.stdout);
  const stderr = readSubprocessOutput(subprocess.stderr);

  const waitForExit = async (): Promise<OpenCodeSubprocessExit> => {
    const waitForDeadline = async (): Promise<"deadline"> => {
      await sleep(openCodeSubprocessDeadlineMs);
      return "deadline";
    };
    const waitForSubprocessExit = async (timedOut: boolean): Promise<OpenCodeSubprocessExit> => ({
      exitCode: await subprocess.exited,
      timedOut,
    });
    const result = await Promise.race([waitForDeadline(), waitForSubprocessExit(false)]);

    if (result !== "deadline") return result;

    subprocess.kill("SIGTERM");

    const waitForForceKill = async (): Promise<"force-kill"> => {
      await sleep(openCodeSubprocessTerminationGraceMs);
      return "force-kill";
    };
    const terminated = await Promise.race([waitForSubprocessExit(true), waitForForceKill()]);

    if (terminated !== "force-kill") return terminated;

    subprocess.kill("SIGKILL");
    return { exitCode: await subprocess.exited, timedOut: true };
  };

  const exit = await waitForExit();
  const [stdoutOutput, stderrOutput] = await Promise.all([stdout, stderr]);

  if (exit.timedOut || exit.exitCode !== 0)
    throw openCodeSubprocessError({
      cmd,
      deadlineMs: openCodeSubprocessDeadlineMs,
      exitCode: exit.exitCode,
      stderr: stderrOutput,
      stdout: stdoutOutput,
      timedOut: exit.timedOut,
    });

  return stdoutOutput;
};

const assertOpenCodeAcceptsConfig = async ({
  configDirectory,
  configFile,
  executable,
  homeDirectory,
  projectDirectory,
}: AssertOpenCodeAcceptsConfigRequest): Promise<void> => {
  const stdout = await runOpenCodeSubprocess({
    cmd: [executable, "debug", "config", "--pure"],
    cwd: projectDirectory,
    env: openCodeEnvironment(homeDirectory, configFile, configDirectory),
  });

  const config = parseOpenCodeDebugConfigOutput(stdout);

  expect(config.username).toBe(openCodeTestUsername);
  expect(config.logLevel).toBe(sampleOpenCodeConfig.logLevel);
  expect(config.server.hostname).toBe(openCodeTestHostname);
  expect(config.server.port).toBe(openCodeTestPort);
};

describe("OpenCode config JSON Schema E2E", () => {
  test("emits importable Zod source that OpenCode accepts as config", async () => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = join(directory, bundledPrinterFileName);
    const generatedModuleFile = join(directory, generatedModuleFileName);
    const projectDirectory = join(directory, projectDirectoryName);
    const homeDirectory = join(directory, homeDirectoryName);
    const configDirectory = join(homeDirectory, ".opencode");
    const generatedConfigFile = join(projectDirectory, generatedConfigFileName);

    try {
      mkdirSync(projectDirectory, { recursive: true });
      mkdirSync(configDirectory, { recursive: true });
      mkdirSync(homeDirectory, { recursive: true });
      buildPrinterBundle(bundleFile);

      await Bun.write(generatedModuleFile, printGeneratedOpenCodeSource(bundleFile));
      const generated = await importGeneratedOpenCodeModule(generatedModuleFile);
      const parsedConfig = generated.openCodeConfigSchema.parse(sampleOpenCodeConfig);

      expect(parsedConfig).toEqual(sampleOpenCodeConfig);

      await Bun.write(generatedConfigFile, JSON.stringify(parsedConfig, null, 2));
      await assertOpenCodeAcceptsConfig({
        configDirectory,
        configFile: generatedConfigFile,
        executable: openCodeExecutable(),
        homeDirectory,
        projectDirectory,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
