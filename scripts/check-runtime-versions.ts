import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface ExpectedRuntimeVersions {
  readonly bun: string;
  readonly node: string;
}

export interface RuntimeVersions {
  readonly bun: string | undefined;
  readonly node: string;
}

export interface ToolchainDeclarationSources {
  readonly bunfig: string;
  readonly ciWorkflow: string;
  readonly flake: string;
  readonly packageJson: string;
  readonly publishWorkflow: string;
}

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

const readRepositoryFile = (filePath: string): string =>
  readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nestedString = (value: unknown, path: readonly string[]): string | undefined => {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
};

const singleCapturedValue = (source: string, pattern: RegExp): string | undefined => {
  const matches = [...source.matchAll(pattern)];
  return matches.length === 1 ? matches.at(0)?.at(1) : undefined;
};

const yamlValue = (source: string, key: string): string | undefined =>
  singleCapturedValue(source, new RegExp(`^\\s*${key}:\\s*([^\\s#]+)\\s*$`, "gmu"));

const nixValue = (source: string, key: string): string | undefined =>
  singleCapturedValue(source, new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)";\\s*$`, "gmu"));

const tomlBoolean = (source: string, key: string): string | undefined =>
  singleCapturedValue(source, new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, "gmu"));

export const readExpectedRuntimeVersions = (): ExpectedRuntimeVersions => ({
  bun: readRepositoryFile(".bun-version").trim(),
  node: readRepositoryFile(".node-version").trim(),
});

const readToolchainDeclarationSources = (): ToolchainDeclarationSources => ({
  bunfig: readRepositoryFile("bunfig.toml"),
  ciWorkflow: readRepositoryFile(".github/workflows/ci.yml"),
  flake: readRepositoryFile("flake.nix"),
  packageJson: readRepositoryFile("package.json"),
  publishWorkflow: readRepositoryFile(".github/workflows/publish.yml"),
});

export const validateToolchainDeclarations = (
  expected: ExpectedRuntimeVersions,
  sources: ToolchainDeclarationSources,
): void => {
  const errors: string[] = [];
  const checkValue = (label: string, actual: string | undefined, expectedValue: string): void => {
    if (actual === expectedValue) return;
    errors.push(
      `${label}: expected ${expectedValue}; received ${actual ?? "missing or duplicate"}.`,
    );
  };

  if (!exactVersionPattern.test(expected.bun))
    errors.push(`.bun-version must contain one exact semantic version; received ${expected.bun}.`);
  if (!exactVersionPattern.test(expected.node))
    errors.push(
      `.node-version must contain one exact semantic version; received ${expected.node}.`,
    );

  const packageManifest: unknown = JSON.parse(sources.packageJson);
  checkValue(
    "package.json engines.bun",
    nestedString(packageManifest, ["engines", "bun"]),
    expected.bun,
  );
  checkValue(
    "package.json engines.node",
    nestedString(packageManifest, ["engines", "node"]),
    expected.node,
  );
  checkValue(
    "package.json packageManager",
    nestedString(packageManifest, ["packageManager"]),
    `bun@${expected.bun}`,
  );

  for (const [label, workflow] of [
    ["ci.yml", sources.ciWorkflow],
    ["publish.yml", sources.publishWorkflow],
  ] as const) {
    checkValue(`${label} BUN_VERSION`, yamlValue(workflow, "BUN_VERSION"), expected.bun);
    checkValue(`${label} NODE_VERSION`, yamlValue(workflow, "NODE_VERSION"), expected.node);
  }

  checkValue("flake.nix bunVersion", nixValue(sources.flake, "bunVersion"), expected.bun);
  checkValue("flake.nix nodeVersion", nixValue(sources.flake, "nodeVersion"), expected.node);
  checkValue("bunfig.toml env", tomlBoolean(sources.bunfig, "env"), "false");
  checkValue("bunfig.toml telemetry", tomlBoolean(sources.bunfig, "telemetry"), "false");

  if (errors.length > 0)
    throw new Error(["Inconsistent repository toolchain declarations.", ...errors].join("\n"));
};

export const validateRuntimeVersions = (
  { bun, node }: RuntimeVersions,
  expected = readExpectedRuntimeVersions(),
): void => {
  if (bun === expected.bun && node === expected.node) return;

  throw new Error(
    [
      "Unsupported JavaScript toolchain.",
      `Expected Bun ${expected.bun}; received ${bun ?? "unknown"}.`,
      `Expected Node.js ${expected.node}; received ${node}.`,
      "Enter the Nix development shell or install the versions in .bun-version and .node-version.",
    ].join("\n"),
  );
};

export const checkRuntimeVersions = (): void => {
  const expected = readExpectedRuntimeVersions();
  validateToolchainDeclarations(expected, readToolchainDeclarationSources());
  const nodeExecutable = process.env["X2ZOD_NODE_BINARY"] ?? "node";
  const node = execFileSync(nodeExecutable, ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^v/u, "");
  validateRuntimeVersions({ bun: process.versions["bun"], node }, expected);
};

if (import.meta.main) checkRuntimeVersions();
