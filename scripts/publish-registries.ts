import nodePath from "node:path";

import { getPackages } from "@manypkg/get-packages";
import type { Package } from "@manypkg/get-packages";
import { publish as publishJsr } from "jsr";
import type { PublishOptions as JsrPublishOptions } from "jsr";

import { withMaterializedPackage } from "./publish-materialize";
import {
  fail,
  fileExists,
  jsonObjectSchema,
  jsrConfigFile,
  notFoundStatus,
  readJsonObject,
  rootDirectory,
  rootNodeModulesCachePath,
  runCommand,
  runningInGitHubActions,
  stringRecordSchema,
  writeJsonObject,
  writeLine,
} from "./publish-runtime";
import type { JsonObject } from "./publish-runtime";
import type { PublishContext, RegistryPublisher } from "./publish-types";

type RegistryResponse = Awaited<ReturnType<typeof fetch>>;
type RegistryFetch = typeof fetch;

const registryMetadataResponseHasVersion = async (
  response: RegistryResponse,
  url: string,
  version: string,
): Promise<boolean> => {
  if (!response.ok) fail(`Registry metadata request failed: ${url} returned ${response.status}.`);

  const { versions } = jsonObjectSchema.parse(await response.json());
  const parsedVersions = jsonObjectSchema.safeParse(versions);
  return parsedVersions.success && version in parsedVersions.data;
};

const registryMetadataHasVersion = async (
  url: string,
  version: string,
  registryFetch: RegistryFetch = fetch,
): Promise<boolean> => {
  const response = await registryFetch(url, { headers: { accept: "application/json" } });
  if (response.status === notFoundStatus) return false;
  return registryMetadataResponseHasVersion(response, url, version);
};

export const npmRegistryHasVersion = async (
  packageName: string,
  version: string,
  registryFetch: RegistryFetch = fetch,
): Promise<boolean> => {
  const encodedPackageName = encodeURIComponent(packageName);
  const metadataUrl = `https://registry.npmjs.org/${encodedPackageName}`;
  const metadataResponse = await registryFetch(metadataUrl, {
    headers: { accept: "application/json" },
  });
  if (metadataResponse.status !== notFoundStatus)
    return registryMetadataResponseHasVersion(metadataResponse, metadataUrl, version);

  const distTagsUrl = `https://registry.npmjs.org/-/package/${encodedPackageName}/dist-tags`;
  const distTagsResponse = await registryFetch(distTagsUrl, {
    headers: { accept: "application/json" },
  });
  if (distTagsResponse.status === notFoundStatus) return false;
  if (!distTagsResponse.ok)
    fail(`Registry dist-tags request failed: ${distTagsUrl} returned ${distTagsResponse.status}.`);

  const distTags = stringRecordSchema.parse(await distTagsResponse.json());
  return Object.values(distTags).includes(version);
};

const jsrPackageMetadataUrl = (packageName: string): string => {
  const match = /^@(?<scope>[a-z0-9-]{2,32})\/(?<name>[a-z0-9-]{2,20})$/u.exec(packageName);
  const scope = match?.groups?.["scope"];
  const name = match?.groups?.["name"];
  return scope === undefined || name === undefined
    ? fail(`JSR package names must be scoped lowercase names: ${packageName}`)
    : `https://jsr.io/@${scope}/${name}/meta.json`;
};

const jsrConfigMatchesPackage = async (workspacePackage: Package): Promise<boolean> => {
  const config = await readJsonObject(nodePath.join(workspacePackage.dir, jsrConfigFile));
  return (
    config["name"] === workspacePackage.packageJson.name &&
    config["version"] === workspacePackage.packageJson.version
  );
};

const syncPackageJsrConfig = async (workspacePackage: Package): Promise<boolean> => {
  const configPath = nodePath.join(workspacePackage.dir, jsrConfigFile);
  if (!(await fileExists(configPath))) return false;

  const config = await readJsonObject(configPath);
  const nextConfig = {
    ...config,
    name: workspacePackage.packageJson.name,
    version: workspacePackage.packageJson.version,
  } satisfies JsonObject;
  if (JSON.stringify(config) === JSON.stringify(nextConfig)) return false;

  await writeJsonObject(configPath, nextConfig);
  return true;
};

export const syncJsrMetadata = async (): Promise<void> => {
  const { packages } = await getPackages(rootDirectory);
  const changes = await Promise.all(
    packages.map(async (workspacePackage) => {
      const changed = await syncPackageJsrConfig(workspacePackage);
      return changed;
    }),
  );
  const changedCount = changes.filter(Boolean).length;
  writeLine(
    changedCount === 0
      ? "JSR metadata already matches package versions."
      : `Synced JSR metadata for ${changedCount.toString()} package(s).`,
  );
};

const npmPublisher = {
  isPackagePublishable: (): boolean => true,
  isVersionPublished: async (workspacePackage: Package): Promise<boolean> => {
    const published = await npmRegistryHasVersion(
      workspacePackage.packageJson.name,
      workspacePackage.packageJson.version,
    );
    return published;
  },
  name: "npm",
  publish: async (workspacePackage: Package, context: PublishContext): Promise<void> => {
    const access = workspacePackage.packageJson.publishConfig?.access ?? context.npmAccess;
    const command = [
      "npm",
      "publish",
      "--access",
      access,
      ...(context.npmTag === undefined ? [] : ["--tag", context.npmTag]),
      ...(context.dryRun ? ["--dry-run"] : []),
      ...(!context.dryRun && runningInGitHubActions ? ["--provenance"] : []),
    ] as const;
    await withMaterializedPackage(workspacePackage, context, ({ directory }) => {
      runCommand(
        command,
        directory,
        `npm publish failed for ${workspacePackage.packageJson.name}.`,
      );
    });
  },
} as const satisfies RegistryPublisher;

const jsrPublisher = {
  isPackagePublishable: async (workspacePackage: Package): Promise<boolean> => {
    const publishable = await fileExists(nodePath.join(workspacePackage.dir, jsrConfigFile));
    return publishable;
  },
  isVersionPublished: async (workspacePackage: Package): Promise<boolean> => {
    const published = await registryMetadataHasVersion(
      jsrPackageMetadataUrl(workspacePackage.packageJson.name),
      workspacePackage.packageJson.version,
    );
    return published;
  },
  name: "jsr",
  publish: async (workspacePackage: Package, context: PublishContext): Promise<void> => {
    if (!(await jsrConfigMatchesPackage(workspacePackage)))
      fail(
        `${workspacePackage.packageJson.name} has stale or missing JSR metadata. Run bun run release:version.`,
      );

    const publishArgs = context.dryRun ? ["--dry-run", "--allow-dirty"] : [];
    await withMaterializedPackage(
      workspacePackage,
      context,
      async ({ directory, manifestPath }) => {
        await publishJsr(directory, {
          binFolder: rootNodeModulesCachePath("jsr"),
          canary: false,
          pkgJsonPath: manifestPath,
          publishArgs,
        } satisfies JsrPublishOptions);
      },
    );
  },
} as const satisfies RegistryPublisher;

export const publishers = [npmPublisher, jsrPublisher] as const;
