import { cp, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import type { Package } from "@manypkg/get-packages";

import { fail, readJsonObject, stringRecordSchema, writeJsonObject } from "./publish-runtime";
import type { JsonObject } from "./publish-runtime";
import { dependencyFields } from "./publish-types";
import type { MaterializedPackage, PublishContext } from "./publish-types";

const workspaceProtocol = "workspace:";

const materializedPathIsIgnored = (filePath: string): boolean =>
  filePath.endsWith(".tsbuildinfo") ||
  filePath
    .split(nodePath.sep)
    .some((segment) => segment === "node_modules" || segment === ".turbo");

const linkNodeModules = async (sourceDirectory: string, targetDirectory: string): Promise<void> => {
  const sourceNodeModules = nodePath.join(sourceDirectory, "node_modules");
  const realSource = await realpath(sourceNodeModules).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (realSource === null) return;

  const targetNodeModules = nodePath.join(targetDirectory, "node_modules");
  await rm(targetNodeModules, { force: true, recursive: true });
  await symlink(realSource, targetNodeModules, "dir");
};

const workspaceRegistryRange = (
  dependencyName: string,
  range: string,
  packageVersions: ReadonlyMap<string, string>,
): string => {
  if (!range.startsWith(workspaceProtocol)) return range;

  const dependencyVersion =
    packageVersions.get(dependencyName) ??
    fail(`workspace protocol dependency is not a workspace package: ${dependencyName}`);
  const workspaceRange = range.slice(workspaceProtocol.length);
  if (workspaceRange === "" || workspaceRange === "*") return dependencyVersion;
  return workspaceRange === "^" || workspaceRange === "~"
    ? `${workspaceRange}${dependencyVersion}`
    : workspaceRange;
};

const rewriteWorkspaceDependencies = (
  manifest: JsonObject,
  packageVersions: ReadonlyMap<string, string>,
): JsonObject => {
  const nextManifest = { ...manifest };
  for (const field of dependencyFields) {
    const dependencies: unknown = nextManifest[field];
    if (dependencies !== undefined) {
      const parsedDependencies = stringRecordSchema.parse(dependencies);
      nextManifest[field] = Object.fromEntries(
        Object.entries(parsedDependencies).map(([name, range]) => [
          name,
          workspaceRegistryRange(name, range, packageVersions),
        ]),
      );
    }
  }
  return nextManifest;
};

const materializePackage = async (
  workspacePackage: Package,
  context: PublishContext,
): Promise<MaterializedPackage> => {
  if (workspacePackage.packageJson.publishConfig?.directory !== undefined)
    fail("publishConfig.directory is not supported by the x2zod registry publisher.");

  const tempRoot = await mkdtemp(nodePath.join(tmpdir(), "x2zod-publish-"));
  const directory = nodePath.join(tempRoot, encodeURIComponent(workspacePackage.packageJson.name));
  await cp(workspacePackage.dir, directory, {
    recursive: true,
    filter: (source) => !materializedPathIsIgnored(source),
  });
  await linkNodeModules(workspacePackage.dir, directory);

  const manifestPath = nodePath.join(directory, "package.json");
  await writeJsonObject(
    manifestPath,
    rewriteWorkspaceDependencies(await readJsonObject(manifestPath), context.packageVersions),
  );
  return { directory, manifestPath, tempRoot };
};

export const withMaterializedPackage = async (
  workspacePackage: Package,
  context: PublishContext,
  use: (materializedPackage: MaterializedPackage) => Promise<void> | void,
): Promise<void> => {
  const materializedPackage = await materializePackage(workspacePackage, context);
  try {
    await use(materializedPackage);
  } finally {
    await rm(materializedPackage.tempRoot, { force: true, recursive: true });
  }
};
