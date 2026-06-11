import { buildInputIdSchema } from "@x2zod/build-inputs";
import type { BuildInputId } from "@x2zod/build-inputs";
import type { Diagnostic } from "@x2zod/core";

import type { JsonSchemaInputPluginOptionsInput, JsonValue } from "../src";

export type RoundTripLevel =
  | "blocked-schema-features"
  | "dedicated-product-e2e"
  | "generated-zod"
  | "schema-unavailable";

export type TargetFixtureSource = Readonly<{
  buildInputId: BuildInputId;
  schemaFileName: string;
  sourceUrl: string;
}>;

type TargetRuntimeSample = Readonly<{ label: string; value: JsonValue }>;

type TargetMatrixBase = Readonly<{ name: string; roundTripLevel: RoundTripLevel }>;

type DedicatedProductTarget = TargetMatrixBase &
  Readonly<{ reason: string; roundTripLevel: "dedicated-product-e2e" }>;

export type GeneratedZodTarget = TargetMatrixBase &
  TargetFixtureSource &
  Readonly<{
    exportName: string;
    invalidSamples: readonly TargetRuntimeSample[];
    pluginOptions: JsonSchemaInputPluginOptionsInput;
    roundTripLevel: "generated-zod";
    typeName: string;
    validSample: TargetRuntimeSample;
  }>;

export type BlockedTarget = TargetMatrixBase &
  TargetFixtureSource &
  Readonly<{
    expectedCodes: readonly Diagnostic["code"][];
    expectedKeywords: readonly string[];
    expectedPhase: "lower" | "prepare";
    pluginOptions: JsonSchemaInputPluginOptionsInput;
    roundTripLevel: "blocked-schema-features";
  }>;

export type SchemaUnavailableTarget = TargetMatrixBase &
  Readonly<{ reason: string; roundTripLevel: "schema-unavailable" }>;

export type TargetMatrixEntry =
  | BlockedTarget
  | DedicatedProductTarget
  | GeneratedZodTarget
  | SchemaUnavailableTarget;

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

const conductorRepoSettingsSample = {
  $schema: conductorRepoSettingsSchema.sourceUrl,
  environment_variables: {
    API_TOKEN: "token",
    cloud: { CLOUD_TOKEN: "token" },
    local: { LOCAL_TOKEN: "token" },
  },
  git: { branch_prefix: "codex/" },
  prompts: { general: "Follow repository conventions." },
  scripts: { run: "bun dev", setup: "bun install" },
} as const;

const codexConfigSample = {
  approval_policy: "on-request",
  model: "gpt-5",
  model_provider: "openai",
  sandbox_mode: "workspace-write",
} as const;

const cursorEnvironmentSample = {
  build: { dockerfile: "Dockerfile" },
  name: "app",
  ports: [{ name: "web", port: 3000 }],
  terminals: [{ command: "bun dev", name: "dev server" }],
} as const;

const targetMatrixEntries = [
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
    exportName: "conductorRepoSettingsSchema",
    invalidSamples: [
      {
        label: "rejects invalid environment variable names",
        value: { ...conductorRepoSettingsSample, environment_variables: { "bad-key": "token" } },
      },
    ],
    name: "Conductor repo settings",
    pluginOptions: { validator: "none" },
    roundTripLevel: "generated-zod",
    typeName: "ConductorRepoSettings",
    validSample: { label: "minimal real repo settings", value: conductorRepoSettingsSample },
  },
  {
    ...codexConfigSchema,
    exportName: "codexConfigSchema",
    invalidSamples: [
      {
        label: "rejects unknown top-level properties",
        value: { ...codexConfigSample, unexpected: true },
      },
      {
        label: "rejects invalid oneOf enum branch values",
        value: { ...codexConfigSample, approval_policy: "sometimes" },
      },
    ],
    name: "Codex config",
    pluginOptions: { dialect: "draft-7", validator: "none" },
    roundTripLevel: "generated-zod",
    typeName: "CodexConfig",
    validSample: { label: "minimal real Codex config", value: codexConfigSample },
  },
  {
    ...claudeCodeSettingsSchema,
    expectedCodes: ["unsupported_keyword"],
    expectedKeywords: ["uniqueItems"],
    expectedPhase: "lower",
    name: "Claude Code settings",
    pluginOptions: { dialect: "draft-7", validator: "none" },
    roundTripLevel: "blocked-schema-features",
  },
  {
    ...cursorEnvironmentSchema,
    exportName: "cursorEnvironmentSchema",
    invalidSamples: [
      {
        label: "rejects unevaluated top-level properties",
        value: { ...cursorEnvironmentSample, unexpected: true },
      },
      {
        label: "rejects unevaluated build properties",
        value: { ...cursorEnvironmentSample, build: { dockerfile: "Dockerfile", extra: true } },
      },
    ],
    name: "Cursor environment",
    pluginOptions: { dialect: "draft-2019-09", validator: "none" },
    roundTripLevel: "generated-zod",
    typeName: "CursorEnvironment",
    validSample: { label: "minimal real Cursor environment", value: cursorEnvironmentSample },
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
] as const satisfies readonly TargetMatrixEntry[];

export const targetMatrix: readonly TargetMatrixEntry[] = targetMatrixEntries;
