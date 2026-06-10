import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildInputIdSchema, buildInputs } from "@x2zod/build-inputs";
import type { BuildInputId } from "@x2zod/build-inputs";
import type { Diagnostic, InputDocument } from "@x2zod/core";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  importGeneratedExport,
  isRecord,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";
import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaInputPluginOptions, JsonSchemaInputPluginOptionsInput } from "../src";

const testDirectory = import.meta.dirname;
const packageRootDirectory = resolve(testDirectory, "..");
const tempRootDirectory = join(packageRootDirectory, "node_modules/.cache");
const tempDirectoryPrefix = "x2zod-json-schema-targets-";
const targetFixtureDirectory = join(testDirectory, "fixtures/targets");
const printerHelperEntryPoint = join(testDirectory, "target-print-helper.ts");
const bundledPrinterFileName = "target-print-helper.mjs";
const generatedModuleFileName = "target.generated.ts";
const optionsFileName = "plugin-options.json";
const jsonSchemaNativePreviewExternals = [...nativePreviewExternals, "jsonc-parser"] as const;
const lastArrayItemOffset = 1;

type TargetZodParseResult = Readonly<{ success: boolean }>;
type TargetZodSchema = Readonly<{ safeParse: (value: unknown) => TargetZodParseResult }>;
type PrintTargetSourceRequest = Readonly<{
  bundleFile: string;
  optionsFile: string;
  schemaFile: string;
  typeName: string;
}>;

type RoundTripLevel =
  | "blocked-schema-features"
  | "dedicated-product-e2e"
  | "generated-zod"
  | "schema-unavailable";

type TargetFixtureSource = Readonly<{
  buildInputId: BuildInputId;
  schemaFileName: string;
  sourceUrl: string;
}>;

type TargetRuntimeSample = Readonly<{ label: string; value: unknown }>;

type TargetMatrixBase = Readonly<{ name: string; roundTripLevel: RoundTripLevel }>;

type DedicatedProductTarget = TargetMatrixBase &
  Readonly<{ reason: string; roundTripLevel: "dedicated-product-e2e" }>;

type GeneratedZodTarget = TargetMatrixBase &
  TargetFixtureSource &
  Readonly<{
    exportName: string;
    invalidSamples: readonly TargetRuntimeSample[];
    pluginOptions: JsonSchemaInputPluginOptionsInput;
    roundTripLevel: "generated-zod";
    typeName: string;
    validSample: TargetRuntimeSample;
  }>;

type BlockedTarget = TargetMatrixBase &
  TargetFixtureSource &
  Readonly<{
    expectedCodes: readonly Diagnostic["code"][];
    expectedKeywords: readonly string[];
    expectedPhase: "lower" | "prepare";
    pluginOptions: JsonSchemaInputPluginOptionsInput;
    roundTripLevel: "blocked-schema-features";
  }>;

type SchemaUnavailableTarget = TargetMatrixBase &
  Readonly<{ reason: string; roundTripLevel: "schema-unavailable" }>;

type TargetMatrixEntry =
  | BlockedTarget
  | DedicatedProductTarget
  | GeneratedZodTarget
  | SchemaUnavailableTarget;

type DiagnosticReport = Readonly<{
  diagnostics: readonly Diagnostic[];
  phase: "lower" | "prepare";
}>;

type BuildInputProvenance = Readonly<{ id: string; path: string; url: string }>;

const buildInputId = (value: string): BuildInputId => buildInputIdSchema.parse(value);

const fixtureSource = (
  buildInputIdValue: string,
  schemaFileName: string,
  sourceUrl: string,
): TargetFixtureSource => ({
  buildInputId: buildInputId(buildInputIdValue),
  schemaFileName,
  sourceUrl,
});

const claudeCodeSettingsSchema = fixtureSource(
  "claude-code-settings-schema",
  "claude-code-settings.schema.json",
  "https://json.schemastore.org/claude-code-settings.json",
);
const codexConfigSchema = fixtureSource(
  "codex-config-schema",
  "codex-config.schema.json",
  "https://developers.openai.com/codex/config-schema.json",
);
const conductorRepoSettingsSchema = fixtureSource(
  "conductor-repo-settings-schema",
  "conductor-repo-settings.schema.json",
  "https://conductor.build/schemas/settings.repo.schema.json",
);
const conductorSettingsSchema = fixtureSource(
  "conductor-settings-schema",
  "conductor-settings.schema.json",
  "https://conductor.build/schemas/settings.schema.json",
);
const cursorEnvironmentSchema = fixtureSource(
  "cursor-environment-schema",
  "cursor-environment.schema.json",
  "https://cursor.com/schemas/environment.schema.json",
);

const targetFixture = (fileName: string): string => join(targetFixtureDirectory, fileName);

const conductorSettingsSample = {
  $schema: conductorSettingsSchema.sourceUrl,
  claude_provider: "anthropic",
  codex_provider: "openai",
  enterprise_data_privacy: true,
  environment_variable_files: [".env"],
  file_include_globs: "**/*",
  git: {
    archive_on_merge: true,
    branch_prefix: "codex/",
    branch_prefix_type: "static",
    delete_branch_on_archive: false,
    worktree_push_auto_setup_remote: true,
  },
  models: {
    claude_code: { default_effort_level: "high", review_effort_level: "medium" },
    codex: {
      default_thinking_level: "high",
      personality: "senior",
      review_thinking_level: "medium",
    },
    default: "sonnet",
    default_fast_mode: false,
    default_plan_mode: true,
    review: "sonnet",
  },
  prompts: {
    code_review: "Review the changes.",
    create_pr: "Create a pull request.",
    fix_errors: "Fix the reported errors.",
    general: "Follow repository conventions.",
    rename_branch: "Rename the branch.",
    resolve_merge_conflicts: "Resolve merge conflicts.",
  },
  scripts: {
    archive: "git status --short",
    auto_run_after_setup: true,
    run: "bun test",
    run_mode: "manual",
    setup: "bun install",
  },
  spotlight_testing: false,
  ssh_key_path: "~/.ssh/id_ed25519",
  tool_approvals_enabled: true,
  vertex_project_id: "example-project",
} as const;

const targetMatrix: readonly TargetMatrixEntry[] = [
  {
    name: "OpenCode config",
    reason:
      "Covered by packages/json-schema/test/opencode.e2e.test.ts with generated Zod parsing and OpenCode CLI config acceptance.",
    roundTripLevel: "dedicated-product-e2e",
  },
  {
    ...conductorSettingsSchema,
    exportName: "conductorSettingsSchema",
    invalidSamples: [
      {
        label: "rejects unknown top-level properties",
        value: { ...conductorSettingsSample, unexpected: true },
      },
    ],
    name: "Conductor user settings",
    pluginOptions: { validator: "ajv" },
    roundTripLevel: "generated-zod",
    typeName: "ConductorSettings",
    validSample: { label: "minimal real user settings", value: conductorSettingsSample },
  },
  {
    ...conductorRepoSettingsSchema,
    expectedCodes: ["unsupported_keyword"],
    expectedKeywords: ["propertyNames"],
    expectedPhase: "lower",
    name: "Conductor repo settings",
    pluginOptions: { validator: "none" },
    roundTripLevel: "blocked-schema-features",
  },
  {
    ...codexConfigSchema,
    expectedCodes: ["unsupported_keyword"],
    expectedKeywords: ["allOf", "maxLength", "minLength", "oneOf"],
    expectedPhase: "lower",
    name: "Codex config",
    pluginOptions: { dialect: "draft-7", validator: "none" },
    roundTripLevel: "blocked-schema-features",
  },
  {
    ...claudeCodeSettingsSchema,
    expectedCodes: ["unknown_keyword", "unsupported_keyword"],
    expectedKeywords: [
      "allowTrailingCommas",
      "examples",
      "minLength",
      "not",
      "propertyNames",
      "uniqueItems",
    ],
    expectedPhase: "lower",
    name: "Claude Code settings",
    pluginOptions: { dialect: "draft-7", validator: "none" },
    roundTripLevel: "blocked-schema-features",
  },
  {
    ...cursorEnvironmentSchema,
    expectedCodes: ["unsupported_dialect"],
    expectedKeywords: ["$schema"],
    expectedPhase: "prepare",
    name: "Cursor environment",
    pluginOptions: { validator: "none" },
    roundTripLevel: "blocked-schema-features",
  },
  {
    name: "Visual Studio Code settings",
    reason:
      "VS Code settings validation is assembled from built-in and extension-contributed configuration at runtime, not published as one stable standalone schema fixture.",
    roundTripLevel: "schema-unavailable",
  },
  {
    name: "Zed settings",
    reason:
      "Zed exposes settings schema data through editor-local zed:// schema URLs rather than a stable public JSON Schema URL.",
    roundTripLevel: "schema-unavailable",
  },
];

const isTargetZodSchema = (value: unknown): value is TargetZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const isGeneratedZodTarget = (target: TargetMatrixEntry): target is GeneratedZodTarget =>
  target.roundTripLevel === "generated-zod";

const isBlockedTarget = (target: TargetMatrixEntry): target is BlockedTarget =>
  target.roundTripLevel === "blocked-schema-features";

const isSchemaUnavailableTarget = (target: TargetMatrixEntry): target is SchemaUnavailableTarget =>
  target.roundTripLevel === "schema-unavailable";

const isFixtureBackedTarget = (
  target: TargetMatrixEntry,
): target is BlockedTarget | GeneratedZodTarget =>
  target.roundTripLevel === "blocked-schema-features" || target.roundTripLevel === "generated-zod";

const buildPrinterBundle = (bundleFile: string): void => {
  buildNodeBundle({
    cwd: packageRootDirectory,
    entryPoint: printerHelperEntryPoint,
    externals: jsonSchemaNativePreviewExternals,
    outfile: bundleFile,
  });
};

const printTargetSource = ({
  bundleFile,
  optionsFile,
  schemaFile,
  typeName,
}: PrintTargetSourceRequest): string =>
  runNode({ args: [bundleFile, schemaFile, typeName, optionsFile], cwd: packageRootDirectory });

const targetDocument = (schemaFile: string): InputDocument => ({
  source: { kind: "file", path: schemaFile },
  text: readFileSync(schemaFile, "utf8"),
});

const targetSchemaFile = (target: TargetFixtureSource): string =>
  targetFixture(target.schemaFileName);

const options = (input: JsonSchemaInputPluginOptionsInput): JsonSchemaInputPluginOptions =>
  jsonSchemaInputPluginOptionsSchema.parse(input);

const diagnosticReportFor = async (target: BlockedTarget): Promise<DiagnosticReport> => {
  const pluginOptions = options(target.pluginOptions);
  const prepared = await jsonSchemaInputPlugin.prepare(
    targetDocument(targetSchemaFile(target)),
    pluginOptions,
  );
  if (!prepared.ok) return { diagnostics: prepared.diagnostics, phase: "prepare" };

  const lowered = await jsonSchemaInputPlugin.lower(prepared.value, pluginOptions);
  return { diagnostics: lowered.diagnostics ?? [], phase: "lower" };
};

const decodePointerSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

const diagnosticKeyword = (diagnostic: Diagnostic): string | undefined => {
  const segment = diagnostic.location?.pointer.split("/").at(-lastArrayItemOffset);
  return segment === undefined || segment === "" ? undefined : decodePointerSegment(segment);
};

const uniqueSortedStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted();

const diagnosticCodes = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  uniqueSortedStrings(diagnostics.map((diagnostic) => diagnostic.code));

const diagnosticKeywords = (diagnostics: readonly Diagnostic[]): readonly string[] =>
  uniqueSortedStrings(
    diagnostics
      .map((diagnostic) => diagnosticKeyword(diagnostic))
      .filter((keyword) => keyword !== undefined),
  );

const buildInputProvenance = (target: TargetFixtureSource): BuildInputProvenance => ({
  id: String(target.buildInputId),
  path: target.schemaFileName,
  url: target.sourceUrl,
});

const compareBuildInputProvenance = (
  left: BuildInputProvenance,
  right: BuildInputProvenance,
): number => left.id.localeCompare(right.id);

const targetBuildInputs = (): readonly BuildInputProvenance[] =>
  targetMatrix
    .filter((target): target is BlockedTarget | GeneratedZodTarget => isFixtureBackedTarget(target))
    .map((target) => buildInputProvenance(target))
    .toSorted(compareBuildInputProvenance);

const resultBuildInputs = async (): Promise<readonly BuildInputProvenance[]> => {
  const result = await buildInputs({ mode: "check", rootDir: targetFixtureDirectory });
  expect(result.lockfileUpdated).toBe(false);
  return result.inputs
    .map(
      (input): BuildInputProvenance => ({ id: String(input.id), path: input.path, url: input.url }),
    )
    .toSorted(compareBuildInputProvenance);
};

const assertInvalidSamplesFail = (target: GeneratedZodTarget, schema: TargetZodSchema): void => {
  for (const invalidSample of target.invalidSamples) {
    const parsed = schema.safeParse(invalidSample.value);
    if (parsed.success)
      throw new Error(`${target.name} accepted invalid sample: ${invalidSample.label}`);
  }
};

describe("JSON Schema public target E2E matrix", () => {
  test("locks fixture provenance with build-inputs", async () => {
    expect(await resultBuildInputs()).toEqual(targetBuildInputs());
  });

  test.each(
    targetMatrix.filter((target): target is GeneratedZodTarget => isGeneratedZodTarget(target)),
  )("$name emits importable Zod source for a valid fixture", async (target) => {
    const directory = createTemporaryDirectory({
      prefix: tempDirectoryPrefix,
      rootDirectory: tempRootDirectory,
    });
    const bundleFile = join(directory, bundledPrinterFileName);
    const generatedFile = join(directory, generatedModuleFileName);
    const optionsFile = join(directory, optionsFileName);

    try {
      await Bun.write(optionsFile, JSON.stringify(target.pluginOptions));
      buildPrinterBundle(bundleFile);
      await Bun.write(
        generatedFile,
        printTargetSource({
          bundleFile,
          optionsFile,
          schemaFile: targetSchemaFile(target),
          typeName: target.typeName,
        }),
      );

      const schema = await importGeneratedExport(
        generatedFile,
        target.exportName,
        isTargetZodSchema,
      );
      expect(schema.safeParse(target.validSample.value).success).toBe(true);
      assertInvalidSamplesFail(target, schema);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each(targetMatrix.filter((target): target is BlockedTarget => isBlockedTarget(target)))(
    "$name reports its current exact blocking schema features",
    async (target) => {
      const report = await diagnosticReportFor(target);

      expect(report.phase).toBe(target.expectedPhase);
      expect(diagnosticCodes(report.diagnostics)).toEqual(
        uniqueSortedStrings(target.expectedCodes),
      );
      expect(diagnosticKeywords(report.diagnostics)).toEqual(
        uniqueSortedStrings(target.expectedKeywords),
      );
    },
  );

  test("tracks discussed targets without stable public schema fixtures", () => {
    const schemaUnavailableTargets = targetMatrix.filter(
      (target): target is SchemaUnavailableTarget => isSchemaUnavailableTarget(target),
    );

    expect(schemaUnavailableTargets.map((target) => target.name)).toEqual([
      "Visual Studio Code settings",
      "Zed settings",
    ]);
    expect(schemaUnavailableTargets.every((target) => target.reason.length > 0)).toBe(true);
  });

  test("records the current round-trip level for every discussed target", () => {
    expect(
      targetMatrix.map((target) => ({ name: target.name, roundTripLevel: target.roundTripLevel })),
    ).toEqual([
      { name: "OpenCode config", roundTripLevel: "dedicated-product-e2e" },
      { name: "Conductor user settings", roundTripLevel: "generated-zod" },
      { name: "Conductor repo settings", roundTripLevel: "blocked-schema-features" },
      { name: "Codex config", roundTripLevel: "blocked-schema-features" },
      { name: "Claude Code settings", roundTripLevel: "blocked-schema-features" },
      { name: "Cursor environment", roundTripLevel: "blocked-schema-features" },
      { name: "Visual Studio Code settings", roundTripLevel: "schema-unavailable" },
      { name: "Zed settings", roundTripLevel: "schema-unavailable" },
    ]);
  });
});
