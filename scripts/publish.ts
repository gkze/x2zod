import { cp, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

import { read as readChangesetConfig } from "@changesets/config";
import { readPreState } from "@changesets/pre";
import { shouldSkipPackage } from "@changesets/should-skip-package";
import type { Config, DependencyType } from "@changesets/types";
import { getPackages } from "@manypkg/get-packages";
import type { Package } from "@manypkg/get-packages";
import { object } from "@optique/core/constructs";
import { message as optiqueMessage } from "@optique/core/message";
import { map, optional, withDefault } from "@optique/core/modifiers";
import { argument, flag, option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { choice, string } from "@optique/core/valueparser";
import type { RunOptions } from "@optique/run";
import { runSync } from "@optique/run";
import { publish as publishJsr } from "jsr";
import type { PublishOptions as JsrPublishOptions } from "jsr";
import { z } from "zod/v4";

type PublishContext = Readonly<{
  dryRun: boolean;
  npmAccess: Config["access"];
  npmTag?: string | undefined;
  packageVersions: ReadonlyMap<string, string>;
}>;

type MaterializedPackage = Readonly<{ directory: string; manifestPath: string; tempRoot: string }>;

type RegistryPublisher<TName extends string = string> = Readonly<{
  isPackagePublishable: (workspacePackage: Package) => Promise<boolean> | boolean;
  isVersionPublished: (workspacePackage: Package) => Promise<boolean>;
  name: TName;
  publish: (workspacePackage: Package, context: PublishContext) => Promise<void>;
}>;

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const satisfies readonly DependencyType[];
const jsrConfigFile = "jsr.json";
const notFoundStatus = 404;
const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const workspaceProtocol = "workspace:";
const runningInGitHubActions = Bun.env["GITHUB_ACTIONS"] === "true";
const jsonObjectSchema = z.record(z.string(), z.json()).readonly();
const stringRecordSchema = z.record(z.string(), z.string()).readonly();

type JsonObject = z.infer<typeof jsonObjectSchema>;

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

const writeLine = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const readJsonObject = async (filePath: string): Promise<JsonObject> =>
  jsonObjectSchema.parse(await Bun.file(filePath).json());

const writeJsonObject = async (filePath: string, value: JsonObject): Promise<void> => {
  await Bun.write(filePath, `${JSON.stringify(value, undefined, 2)}\n`);
};

const runCommand = async (
  command: readonly [string, ...string[]],
  cwd: string,
  failureMessage: string,
): Promise<void> => {
  writeLine(`$ ${command.join(" ")}`);
  const childProcess = Bun.spawn([...command], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  if ((await childProcess.exited) !== 0) fail(failureMessage);
};

const registryMetadataHasVersion = async (url: string, version: string): Promise<boolean> => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === notFoundStatus) return false;
  if (!response.ok) fail(`Registry metadata request failed: ${url} returned ${response.status}.`);

  const { versions } = jsonObjectSchema.parse(await response.json());
  const parsedVersions = jsonObjectSchema.safeParse(versions);
  return parsedVersions.success && version in parsedVersions.data;
};

const jsrPackageMetadataUrl = (packageName: string): string => {
  const match = /^@(?<scope>[a-z0-9-]{2,32})\/(?<name>[a-z0-9-]{2,20})$/u.exec(packageName);
  const scope = match?.groups?.["scope"];
  const name = match?.groups?.["name"];
  return scope === undefined || name === undefined
    ? fail(`JSR package names must be scoped lowercase names: ${packageName}`)
    : `https://jsr.io/@${scope}/${name}/meta.json`;
};

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

const withMaterializedPackage = async (
  workspacePackage: Package,
  context: PublishContext,
  use: (materializedPackage: MaterializedPackage) => Promise<void>,
): Promise<void> => {
  const materializedPackage = await materializePackage(workspacePackage, context);
  try {
    await use(materializedPackage);
  } finally {
    await rm(materializedPackage.tempRoot, { force: true, recursive: true });
  }
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
  if (!(await Bun.file(configPath).exists())) return false;

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

const syncJsrMetadata = async (): Promise<void> => {
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
    const published = await registryMetadataHasVersion(
      `https://registry.npmjs.org/${encodeURIComponent(workspacePackage.packageJson.name)}`,
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
    await withMaterializedPackage(workspacePackage, context, async ({ directory }) => {
      await runCommand(
        command,
        directory,
        `npm publish failed for ${workspacePackage.packageJson.name}.`,
      );
    });
  },
} as const satisfies RegistryPublisher;

const jsrPublisher = {
  isPackagePublishable: async (workspacePackage: Package): Promise<boolean> => {
    const publishable = await Bun.file(nodePath.join(workspacePackage.dir, jsrConfigFile)).exists();
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
          binFolder: nodePath.join(rootDirectory, "node_modules", ".cache", "jsr"),
          canary: false,
          pkgJsonPath: manifestPath,
          publishArgs,
        } satisfies JsrPublishOptions);
      },
    );
  },
} as const satisfies RegistryPublisher;

const publishers = [npmPublisher, jsrPublisher] as const;
type RegistryName = (typeof publishers)[number]["name"];
type PublishOptions = Readonly<{
  dryRun: boolean;
  mode: "publish";
  registry: RegistryName | undefined;
  tag: string | undefined;
}>;
type PublishCommand = PublishOptions | Readonly<{ mode: "sync-jsr-metadata" }>;
const program = defineProgram({
  metadata: { brief: optiqueMessage`Publish x2zod workspace packages.`, name: "publish" },
  parser: map(
    object({
      dryRun: withDefault(
        option("-d", "--dry-run", {
          description: optiqueMessage`Run registry publish commands without writing registry versions.`,
        }),
        false,
      ),
      registry: optional(
        argument(choice(publishers.map(({ name }) => name)), {
          description: optiqueMessage`Optional registry adapter name. Omit to publish every adapter.`,
        }),
      ),
      shouldSyncJsrMetadata: withDefault(
        flag("-s", "--sync-jsr-metadata", {
          description: optiqueMessage`Sync JSR name and version metadata from package manifests.`,
        }),
        false,
      ),
      tag: optional(
        option("-t", "--tag", string({ metavar: "TAG" }), {
          description: optiqueMessage`npm dist-tag override for npm publishes.`,
        }),
      ),
    }),
    ({ shouldSyncJsrMetadata, ...options }): PublishCommand => {
      if (!shouldSyncJsrMetadata) return { ...options, mode: "publish" };
      if (options.dryRun || options.registry !== undefined || options.tag !== undefined)
        fail("--sync-jsr-metadata cannot be combined with publish options.");

      return { mode: "sync-jsr-metadata" };
    },
  ),
});
const runOptions = {
  aboveError: "usage",
  help: { option: { names: ["-h", "--help"] } },
} satisfies RunOptions;
const sortByInternalDependencies = (workspacePackages: readonly Package[]): readonly Package[] => {
  const byName = new Map(
    workspacePackages.map((workspacePackage) => [
      workspacePackage.packageJson.name,
      workspacePackage,
    ]),
  );
  const sorted: Package[] = [];
  const states = new Map<string, "visited" | "visiting">();
  const visit = (workspacePackage: Package): void => {
    const packageName = workspacePackage.packageJson.name;
    const state = states.get(packageName);
    if (state === "visited") return;
    if (state === "visiting") fail(`Workspace dependency cycle includes ${packageName}.`);

    states.set(packageName, "visiting");
    for (const field of dependencyFields)
      for (const dependencyName of Object.keys(workspacePackage.packageJson[field] ?? {})) {
        const dependency = byName.get(dependencyName);
        if (dependency !== undefined) visit(dependency);
      }
    states.set(packageName, "visited");
    sorted.push(workspacePackage);
  };

  for (const workspacePackage of workspacePackages.toSorted((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  ))
    visit(workspacePackage);
  return sorted;
};

const publishRegistryPackage = async (
  publisher: RegistryPublisher,
  workspacePackage: Package,
  context: PublishContext,
): Promise<number> => {
  const packageLabel = `${workspacePackage.packageJson.name}@${workspacePackage.packageJson.version}`;
  const versionPublished =
    !context.dryRun && (await publisher.isVersionPublished(workspacePackage));
  if (versionPublished) {
    writeLine(`${packageLabel} is already published to ${publisher.name}; skipping.`);
    return 0;
  }

  writeLine(
    `${context.dryRun ? "Checking" : "Publishing"} ${packageLabel} with ${publisher.name}...`,
  );
  await publisher.publish(workspacePackage, context);
  return 1;
};

const publishRegistries = async (
  publishersToRun: readonly RegistryPublisher[],
  workspacePackages: readonly Package[],
  context: PublishContext,
): Promise<number> => {
  let published = 0;
  for (const publisher of publishersToRun)
    for (const workspacePackage of workspacePackages)
      if (await publisher.isPackagePublishable(workspacePackage))
        published += await publishRegistryPackage(publisher, workspacePackage, context);
  return published;
};

const publishPackages = async (options: PublishOptions): Promise<void> => {
  const packages = await getPackages(rootDirectory);
  const config = await readChangesetConfig(packages.rootDir);
  const workspacePackages = sortByInternalDependencies(
    packages.packages.filter(
      (workspacePackage) =>
        !shouldSkipPackage(workspacePackage, {
          allowPrivatePackages: config.privatePackages.version,
          ignore: config.ignore,
        }),
    ),
  );
  const publishersToRun =
    options.registry === undefined
      ? publishers
      : publishers.filter((publisher) => publisher.name === options.registry);
  const preState = await readPreState(packages.rootDir);
  const context: PublishContext = {
    dryRun: options.dryRun,
    npmAccess: config.access,
    packageVersions: new Map(
      packages.packages.map(({ packageJson }) => [packageJson.name, packageJson.version]),
    ),
    ...(options.tag === undefined && preState?.mode !== "pre"
      ? {}
      : { npmTag: options.tag ?? preState?.tag }),
  };
  const published = await publishRegistries(publishersToRun, workspacePackages, context);
  if (!options.dryRun && options.registry === undefined && published > 0)
    await runCommand(
      [Bun.argv[0] ?? "bun", "run", "changeset", "tag"],
      packages.rootDir,
      "changeset tag failed after registry publish.",
    );
};

const main = async (): Promise<void> => {
  const command = runSync(program, { ...runOptions, args: Bun.argv.slice(2) });
  if (command.mode === "sync-jsr-metadata") return syncJsrMetadata();
  await publishPackages(command);
};

await main().catch((error: unknown) => {
  if (process.exitCode !== undefined) return;
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown publish failure."}\n`);
  process.exitCode = 1;
});
