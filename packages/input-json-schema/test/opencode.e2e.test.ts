import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import nodePath from "node:path";
import process from "node:process";
import { describe, test } from "node:test";

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
const packageRootDirectory = nodePath.resolve(testDirectory, "..");
const repositoryRootDirectory = nodePath.resolve(packageRootDirectory, "../..");
const tempRootDirectory = nodePath.join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-opencode-e2e-";
const printerHelperEntryPoint = nodePath.join(testDirectory, "opencode-print-helper.ts");
const bundledPrinterFileName = "opencode-print-helper.mjs";
const generatedModuleFileName = "opencode.generated.ts";
const generatedConfigFileName = "opencode.json";
const homeDirectoryName = "home";
const projectDirectoryName = "project";
const openCodeConfigSchemaFixture = nodePath.join(
  testDirectory,
  "fixtures/opencode/config.schema.json",
);
const modelSchemaFixture = nodePath.join(testDirectory, "fixtures/opencode/model-schema.json");
const openCodeShimBinaryName = process.platform === "win32" ? "opencode.cmd" : "opencode";
const openCodeNativeBinaryName = process.platform === "win32" ? "opencode.exe" : "opencode";
const openCodeConfigSchemaExport = "openCodeConfigSchema";
const openCodeSchemaUrl = "https://opencode.ai/config.json";
const openCodeTestHostname = "127.0.0.1";
const openCodeTestPort = 4099;
const openCodeTestUsername = "x2zod-e2e";
const openCodeSubprocessDeadlineMs = 12_000;
const openCodeTestTimeoutMs = 15_000;
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

const pathExecutable = (binaryName: string): string | undefined =>
  process.env["PATH"]
    ?.split(nodePath.delimiter)
    .map((directory) => nodePath.join(directory, binaryName))
    .find((candidate) => existsSync(candidate));

const openCodeNativePackageNames = (): readonly string[] => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const baseName = `opencode-${platform}-${process.arch}`;
  if (process.arch !== "x64")
    return platform === "linux" ? [baseName, `${baseName}-musl`] : [baseName];

  return platform === "linux"
    ? [`${baseName}-baseline`, baseName, `${baseName}-baseline-musl`, `${baseName}-musl`]
    : [`${baseName}-baseline`, baseName];
};

const openCodeNativeBinaryCandidates = (): readonly string[] => {
  const packageRequire = createRequire(
    createRequire(import.meta.url).resolve("opencode-ai/package.json"),
  );
  return openCodeNativePackageNames().flatMap((packageName) => {
    try {
      const packageJson = packageRequire.resolve(`${packageName}/package.json`);
      return [nodePath.join(nodePath.dirname(packageJson), "bin", openCodeNativeBinaryName)];
    } catch {
      return [];
    }
  });
};

const isWorkingExecutable = (executable: string): boolean => {
  const subprocess = spawnSync(executable, ["--version"], { stdio: "ignore" });
  return subprocess.error === undefined && subprocess.status === 0;
};

const openCodeBinaryCandidates = (): readonly string[] => {
  const pathCandidate = pathExecutable(openCodeShimBinaryName);
  return [
    ...openCodeNativeBinaryCandidates(),
    nodePath.join(packageRootDirectory, "node_modules/.bin", openCodeShimBinaryName),
    nodePath.join(repositoryRootDirectory, "node_modules/.bin", openCodeShimBinaryName),
    ...(pathCandidate === undefined ? [] : [pathCandidate]),
  ];
};

const openCodeExecutable = (): string => {
  const executable = openCodeBinaryCandidates().find(
    (candidate) => existsSync(candidate) && isWorkingExecutable(candidate),
  );
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
  XDG_CACHE_HOME: nodePath.join(homeDirectory, ".cache"),
  XDG_CONFIG_HOME: nodePath.join(homeDirectory, ".config"),
  XDG_DATA_HOME: nodePath.join(homeDirectory, ".local/share"),
  XDG_STATE_HOME: nodePath.join(homeDirectory, ".local/state"),
});

const parseOpenCodeDebugConfigOutput = (stdout: Uint8Array): OpenCodeDebugConfig =>
  openCodeDebugConfigSchema.parse(JSON.parse(outputText(stdout)));

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

const runOpenCodeSubprocess = ({
  cmd,
  cwd,
  env,
}: Readonly<{
  cmd: readonly [string, ...string[]];
  cwd: string;
  env: Record<string, string>;
}>): Uint8Array => {
  const subprocess = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    env,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: openCodeSubprocessDeadlineMs,
  });
  if (subprocess.error !== undefined) throw subprocess.error;

  const exitCode = subprocess.status ?? 1;
  const timedOut = subprocess.signal === "SIGKILL";
  const stdoutOutput = subprocess.stdout;
  const stderrOutput = subprocess.stderr;

  if (timedOut || exitCode !== 0)
    throw openCodeSubprocessError({
      cmd,
      deadlineMs: openCodeSubprocessDeadlineMs,
      exitCode,
      stderr: stderrOutput,
      stdout: stdoutOutput,
      timedOut,
    });

  return stdoutOutput;
};

const assertOpenCodeAcceptsConfig = ({
  configDirectory,
  configFile,
  executable,
  homeDirectory,
  projectDirectory,
}: AssertOpenCodeAcceptsConfigRequest): void => {
  const stdout = runOpenCodeSubprocess({
    cmd: [executable, "debug", "config", "--pure"],
    cwd: projectDirectory,
    env: openCodeEnvironment(homeDirectory, configFile, configDirectory),
  });

  const config = parseOpenCodeDebugConfigOutput(stdout);

  assert.equal(config.username, openCodeTestUsername);
  assert.equal(config.logLevel, sampleOpenCodeConfig.logLevel);
  assert.equal(config.server.hostname, openCodeTestHostname);
  assert.equal(config.server.port, openCodeTestPort);
};

void describe("OpenCode config JSON Schema E2E", () => {
  void test(
    "emits importable Zod source that OpenCode accepts as config",
    { timeout: openCodeTestTimeoutMs },
    async () => {
      const directory = createTemporaryDirectory({
        prefix: tempDirectoryPrefix,
        rootDirectory: tempRootDirectory,
      });
      const bundleFile = nodePath.join(directory, bundledPrinterFileName);
      const generatedModuleFile = nodePath.join(directory, generatedModuleFileName);
      const projectDirectory = nodePath.join(directory, projectDirectoryName);
      const homeDirectory = nodePath.join(directory, homeDirectoryName);
      const configDirectory = nodePath.join(homeDirectory, ".opencode");
      const generatedConfigFile = nodePath.join(projectDirectory, generatedConfigFileName);

      try {
        mkdirSync(projectDirectory, { recursive: true });
        mkdirSync(configDirectory, { recursive: true });
        mkdirSync(homeDirectory, { recursive: true });
        buildPrinterBundle(bundleFile);

        await writeFile(generatedModuleFile, printGeneratedOpenCodeSource(bundleFile));
        const generated = await importGeneratedOpenCodeModule(generatedModuleFile);
        const parsedConfig = generated.openCodeConfigSchema.parse(sampleOpenCodeConfig);

        assert.deepEqual(parsedConfig, sampleOpenCodeConfig);

        await writeFile(generatedConfigFile, JSON.stringify(parsedConfig, null, 2));
        assertOpenCodeAcceptsConfig({
          configDirectory,
          configFile: generatedConfigFile,
          executable: openCodeExecutable(),
          homeDirectory,
          projectDirectory,
        });
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );
});
