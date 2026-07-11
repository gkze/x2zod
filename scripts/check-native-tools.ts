import { execFileSync } from "node:child_process";

export type NativeTool = "actionlint" | "shellcheck";

const expectedNativeToolVersions: Readonly<Record<NativeTool, string>> = {
  actionlint: "1.7.12",
  shellcheck: "0.11.0",
};

const nativeToolLabels: Readonly<Record<NativeTool, string>> = {
  actionlint: "actionlint",
  shellcheck: "ShellCheck",
};

const requiredExecutable = (name: "ACTIONLINT_BIN" | "SHELLCHECK_BINARY"): string => {
  const executable = process.env[name];

  if (executable === undefined || executable.length === 0)
    throw new Error(`${name} must point to the pinned binary provisioned by Nix or CI.`);

  return executable;
};

export const validateNativeToolVersion = (tool: NativeTool, version: string | undefined): void => {
  const expectedVersion = expectedNativeToolVersions[tool];
  if (version === expectedVersion) return;
  throw new Error(
    `Expected ${nativeToolLabels[tool]} ${expectedVersion}; received ${version ?? "unknown"}.`,
  );
};

const checkActionlint = (): void => {
  const executable = requiredExecutable("ACTIONLINT_BIN");
  const [version] = execFileSync(executable, ["-version"], { encoding: "utf8" })
    .trim()
    .split("\n", 1);

  validateNativeToolVersion("actionlint", version);
};

const checkShellCheck = (): void => {
  const executable = requiredExecutable("SHELLCHECK_BINARY");
  const versionOutput = execFileSync(executable, ["--version"], { encoding: "utf8" });
  const version = /^version: (?<version>\S+)$/mu.exec(versionOutput)?.groups?.["version"];

  validateNativeToolVersion("shellcheck", version);
};

export const checkNativeTool = (tool: NativeTool): void => {
  if (tool === "actionlint") {
    checkActionlint();
    checkShellCheck();
  } else checkShellCheck();
};

if (import.meta.main) {
  const [tool] = process.argv.slice(2);
  if (tool === "actionlint" || tool === "shellcheck") checkNativeTool(tool);
  else throw new Error("Usage: bun scripts/check-native-tools.ts <actionlint|shellcheck>");
}
