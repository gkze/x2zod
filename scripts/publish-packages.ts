import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { object } from "@optique/core/constructs";
import { message as optiqueMessage } from "@optique/core/message";
import { argument, option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { choice } from "@optique/core/valueparser";
import type { RunOptions } from "@optique/run";
import { runSync } from "@optique/run";

type Registry = "jsr" | "npm";

type DependencyField = "dependencies" | "optionalDependencies" | "peerDependencies";

type PackageJson = Readonly<{
  name?: string;
  private?: boolean;
  workspaces?: readonly string[];
  dependencies?: Readonly<Record<string, string>>;
  optionalDependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
}>;
type ParsedPackageJson = { -readonly [Key in keyof PackageJson]: PackageJson[Key] };
type UnknownRecord = Readonly<Record<string, unknown>>;

type WorkspacePackage = Readonly<{ directory: string; manifest: PackageJson; name: string }>;

type Options = Readonly<{ allowEmpty: boolean; dryRun: boolean; registry: Registry }>;

const dependencyFields: readonly DependencyField[] = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const packageNamePrefix = "@x2zod/";
const registries = ["jsr", "npm"] as const;
const rootDirectory = new URL("..", import.meta.url).pathname;
const workspaceGlobSuffix = "/*";
const program = defineProgram({
  metadata: { brief: optiqueMessage`Publish x2zod workspace packages.`, name: "publish-packages" },
  parser: object({
    allowEmpty: option("--allow-empty", {
      description: optiqueMessage`Exit successfully when there are no publishable workspace packages.`,
    }),
    dryRun: option("--dry-run", {
      description: optiqueMessage`Run the registry publish command without publishing packages.`,
    }),
    registry: argument(choice(registries), {
      description: optiqueMessage`Package registry to publish to.`,
    }),
  }),
});
const runOptions = {
  aboveError: "usage",
  help: { option: { names: ["-h", "--help"] } },
} satisfies RunOptions;

const writeLine = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalStringField = (
  manifest: UnknownRecord,
  path: string,
  key: string,
): string | undefined => {
  const value = manifest[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return fail(`${path} field ${key} must be a string.`);
};

const optionalBooleanField = (
  manifest: UnknownRecord,
  path: string,
  key: string,
): boolean | undefined => {
  const value = manifest[key];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  return fail(`${path} field ${key} must be a boolean.`);
};

const optionalStringArrayField = (
  manifest: UnknownRecord,
  path: string,
  key: string,
): readonly string[] | undefined => {
  const value = manifest[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return fail(`${path} field ${key} must be an array of strings.`);
};

const optionalStringRecordField = (
  manifest: UnknownRecord,
  path: string,
  key: DependencyField,
): Readonly<Record<string, string>> | undefined => {
  const value = manifest[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) return fail(`${path} field ${key} must be an object.`);
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== "string") return fail(`${path} field ${key}.${name} must be a string.`);
    dependencies[name] = range;
  }
  return dependencies;
};

const parsePackageJson = (path: string, text: string): PackageJson => {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) return fail(`${path} must contain a JSON object.`);

  const manifest: ParsedPackageJson = {};
  const name = optionalStringField(value, path, "name");
  const privatePackage = optionalBooleanField(value, path, "private");
  const workspaces = optionalStringArrayField(value, path, "workspaces");
  if (name !== undefined) manifest.name = name;
  if (privatePackage !== undefined) manifest.private = privatePackage;
  if (workspaces !== undefined) manifest.workspaces = workspaces;
  for (const field of dependencyFields) {
    const dependencies = optionalStringRecordField(value, path, field);
    if (dependencies !== undefined) manifest[field] = dependencies;
  }
  return manifest;
};

const readPackageJson = async (path: string): Promise<PackageJson> =>
  parsePackageJson(path, await readFile(path, "utf8"));

const workspaceDirectories = async (workspaceGlob: string): Promise<readonly string[]> => {
  if (!workspaceGlob.endsWith(workspaceGlobSuffix)) return [workspaceGlob];

  const workspaceRoot = workspaceGlob.slice(0, -workspaceGlobSuffix.length);
  const entries = await readdir(join(rootDirectory, workspaceRoot), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => join(workspaceRoot, name));
};

const readWorkspacePackages = async (): Promise<readonly WorkspacePackage[]> => {
  const rootManifest = await readPackageJson(join(rootDirectory, "package.json"));
  const workspaces = rootManifest.workspaces ?? [];
  const workspaceDirectoryGroups = await Promise.all(
    workspaces.map(async (workspace) => {
      const directories = await workspaceDirectories(workspace);
      return directories;
    }),
  );
  const directories = workspaceDirectoryGroups.flat();
  const manifests = await Promise.all(
    directories.map(async (directory) => ({
      directory,
      manifest: await readPackageJson(join(rootDirectory, directory, "package.json")),
    })),
  );

  return manifests.flatMap(({ directory, manifest }) =>
    manifest.private === true || manifest.name === undefined
      ? []
      : [{ directory, manifest, name: manifest.name }],
  );
};

const internalDependencies = (
  workspacePackage: WorkspacePackage,
  internalPackageNames: ReadonlySet<string>,
): readonly string[] =>
  dependencyFields.flatMap((field) =>
    Object.keys(workspacePackage.manifest[field] ?? {}).filter((name) =>
      internalPackageNames.has(name),
    ),
  );

const sortByInternalDependencies = (
  workspacePackages: readonly WorkspacePackage[],
): readonly WorkspacePackage[] => {
  const byName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const internalPackageNames = new Set(byName.keys());
  const sorted: WorkspacePackage[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (workspacePackage: WorkspacePackage): void => {
    if (visited.has(workspacePackage.name)) return;
    if (visiting.has(workspacePackage.name))
      fail(`Workspace dependency cycle includes ${workspacePackage.name}.`);

    visiting.add(workspacePackage.name);
    for (const dependencyName of internalDependencies(workspacePackage, internalPackageNames)) {
      const dependency = byName.get(dependencyName);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(workspacePackage.name);
    visited.add(workspacePackage.name);
    sorted.push(workspacePackage);
  };

  const sortedPackages = workspacePackages.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const workspacePackage of sortedPackages) visit(workspacePackage);

  return sorted;
};

const workspaceDependencyIssues = (workspacePackage: WorkspacePackage): readonly string[] =>
  dependencyFields.flatMap((field) =>
    Object.entries(workspacePackage.manifest[field] ?? {}).flatMap(([name, range]) =>
      range.startsWith("workspace:")
        ? [`${workspacePackage.name} ${field}.${name} = ${range}`]
        : [],
    ),
  );

const assertPublishableManifest = (workspacePackage: WorkspacePackage): void => {
  if (!workspacePackage.name.startsWith(packageNamePrefix))
    fail(
      `Publishable workspace package names must use the ${packageNamePrefix} scope: ${workspacePackage.name}`,
    );

  const issues = workspaceDependencyIssues(workspacePackage);
  if (issues.length === 0) return;

  fail(
    [
      `Cannot publish ${workspacePackage.name} with workspace dependency ranges:`,
      ...issues.map((issue) => `  ${issue}`),
      "Run the release/versioning step first so published manifests contain registry versions.",
    ].join("\n"),
  );
};

const jsrCliEntrypoint = (): string => {
  const candidates = [
    join(rootDirectory, ".publish-tools", "node_modules", "jsr", "dist", "bin.js"),
    join(rootDirectory, "node_modules", "jsr", "dist", "bin.js"),
  ];
  const entrypoint = candidates.find((candidate) => existsSync(candidate));
  if (entrypoint !== undefined) return entrypoint;

  return fail(["JSR CLI is not installed.", "Run bun install first."].join(" "));
};

const commandForPackage = ({ dryRun, registry }: Options): string[] =>
  registry === "npm"
    ? ["npm", "publish", "--access", "public", "--provenance", ...(dryRun ? ["--dry-run"] : [])]
    : ["node", jsrCliEntrypoint(), "publish", ...(dryRun ? ["--dry-run"] : [])];

const publishPackage = async (
  options: Options,
  workspacePackage: WorkspacePackage,
): Promise<void> => {
  assertPublishableManifest(workspacePackage);

  const command = commandForPackage(options);
  writeLine(
    `Publishing ${workspacePackage.name} to ${options.registry} from ${workspacePackage.directory}...`,
  );
  const childProcess = Bun.spawn(command, {
    cwd: join(rootDirectory, workspacePackage.directory),
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const exitCode = await childProcess.exited;
  if (exitCode !== 0) fail(`${command.join(" ")} failed for ${workspacePackage.name}.`);
};

const publishSequentially = async (
  options: Options,
  workspacePackages: readonly WorkspacePackage[],
): Promise<void> => {
  const [workspacePackage, ...remainingPackages] = workspacePackages;
  if (workspacePackage === undefined) return;

  await publishPackage(options, workspacePackage);
  await publishSequentially(options, remainingPackages);
};

const publishPackages = async (options: Options): Promise<void> => {
  const workspacePackages = sortByInternalDependencies(await readWorkspacePackages());
  if (workspacePackages.length === 0) {
    const message = "No non-private workspace packages are publishable.";
    if (options.allowEmpty) {
      writeLine(message);
      return;
    }
    fail(message);
  }

  writeLine(
    `Publishing ${workspacePackages.length.toString()} package(s) to ${options.registry}${
      options.dryRun ? " in dry-run mode." : "."
    }`,
  );

  await publishSequentially(options, workspacePackages);
};

await publishPackages(runSync(program, { ...runOptions, args: Bun.argv.slice(2) })).catch(
  (error: unknown) => {
    if (process.exitCode === undefined) {
      process.stderr.write(
        error instanceof Error ? `${error.message}\n` : "Unknown publish failure.\n",
      );
      process.exitCode = 1;
    }
  },
);
