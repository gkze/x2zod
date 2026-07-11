import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface InstallRepositoryHooksOptions {
  readonly install?: () => void;
  readonly repositoryRoot?: string;
}

const installPrekHooks = (): void => {
  execFileSync(
    "prek",
    [
      "install",
      "--hook-type",
      "pre-commit",
      "--hook-type",
      "commit-msg",
      "--hook-type",
      "pre-push",
      "--overwrite",
    ],
    { stdio: "inherit" },
  );
};

export const installRepositoryHooks = ({
  install = installPrekHooks,
  repositoryRoot = process.cwd(),
}: InstallRepositoryHooksOptions = {}): boolean => {
  if (!existsSync(path.join(repositoryRoot, ".git"))) return false;

  install();
  return true;
};

if (import.meta.main) installRepositoryHooks();
