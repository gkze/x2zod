import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

type WorkspacePackage = Readonly<{ directory: string; manifest: PackageJson; name: string }>;

type Options = Readonly<{ allowEmpty: boolean; dryRun: boolean; registry: Registry }>;

const dependencyFields: readonly DependencyField[] = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const packageNamePrefix = "@x2zod/";
const rootDirectory = new URL("..", import.meta.url).pathname;
const workspaceGlobSuffix = "/*";

const writeLine = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};

const parseRegistry = (args: readonly string[]): Registry => {
  if (args.includes("jsr")) return "jsr";
  if (args.includes("npm")) return "npm";

  return fail("usage: bun scripts/publish-packages.ts <npm|jsr> [--dry-run] [--allow-empty]");
};

const parseOptions = (args: readonly string[]): Options => ({
  allowEmpty: args.includes("--allow-empty"),
  dryRun: args.includes("--dry-run"),
  registry: parseRegistry(args),
});

const readPackageJson = async (path: string): Promise<PackageJson> =>
  JSON.parse(await readFile(path, "utf8")) as PackageJson;

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
    if (visiting.has(workspacePackage.name)) {
      fail(`Workspace dependency cycle includes ${workspacePackage.name}.`);
    }

    visiting.add(workspacePackage.name);
    for (const dependencyName of internalDependencies(workspacePackage, internalPackageNames)) {
      const dependency = byName.get(dependencyName);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(workspacePackage.name);
    visited.add(workspacePackage.name);
    sorted.push(workspacePackage);
  };

  for (const workspacePackage of workspacePackages.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    visit(workspacePackage);
  }

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
  if (!workspacePackage.name.startsWith(packageNamePrefix)) {
    fail(
      `Publishable workspace package names must use the ${packageNamePrefix} scope: ${workspacePackage.name}`,
    );
  }

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

  return fail("JSR CLI is not installed. Run bun install first.");
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

await publishPackages(parseOptions(Bun.argv.slice(2))).catch((error: unknown) => {
  if (process.exitCode === undefined) {
    process.stderr.write(
      error instanceof Error ? `${error.message}\n` : "Unknown publish failure.\n",
    );
    process.exitCode = 1;
  }
});
