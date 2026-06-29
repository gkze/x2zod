#!/usr/bin/env bun

import process from "node:process";

import { read as readChangesetConfig } from "@changesets/config";
import { readPreState } from "@changesets/pre";
import { shouldSkipPackage } from "@changesets/should-skip-package";
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

import { publishers, syncJsrMetadata } from "./publish-registries";
import { bunExecutable, fail, rootDirectory, runCommand, writeLine } from "./publish-runtime";
import { dependencyFields } from "./publish-types";
import type { PublishContext, RegistryPublisher } from "./publish-types";

export type { PublishContext, RegistryPublisher } from "./publish-types";

const currentModulePath = import.meta.filename;

type RegistryName = (typeof publishers)[number]["name"];
type PublishOptions = Readonly<{
  dryRun: boolean;
  mode: "publish";
  registry: RegistryName | undefined;
  tag: string | undefined;
}>;
type PublishCommand = PublishOptions | Readonly<{ mode: "sync-jsr-metadata" }>;
type PublishFailure = Readonly<{
  message: string;
  packageLabel: string;
  registry: RegistryPublisher["name"];
}>;
type PublishRegistriesResult = Readonly<{ failures: readonly PublishFailure[]; published: number }>;

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

export const publishRegistryPackage = async (
  publisher: RegistryPublisher,
  workspacePackage: Package,
  context: PublishContext,
): Promise<number> => {
  const packageLabel = `${workspacePackage.packageJson.name}@${workspacePackage.packageJson.version}`;
  const versionPublished = await publisher.isVersionPublished(workspacePackage);
  if (versionPublished) {
    writeLine(
      `${packageLabel} is already published to ${publisher.name}; ${context.dryRun ? "would skip" : "skipping"}.`,
    );
    return 0;
  }

  writeLine(
    `${context.dryRun ? "Checking" : "Publishing"} ${packageLabel} with ${publisher.name}...`,
  );
  await publisher.publish(workspacePackage, context);
  return 1;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown publish failure.";

export const publishRegistries = async (
  publishersToRun: readonly RegistryPublisher[],
  workspacePackages: readonly Package[],
  context: PublishContext,
): Promise<PublishRegistriesResult> => {
  const failures: PublishFailure[] = [];
  let published = 0;
  for (const publisher of publishersToRun)
    for (const workspacePackage of workspacePackages) {
      // Publish reconciliation is intentionally serial to preserve dependency order.
      // eslint-disable-next-line no-await-in-loop
      const publishable = await publisher.isPackagePublishable(workspacePackage);

      if (publishable) {
        const packageLabel = `${workspacePackage.packageJson.name}@${workspacePackage.packageJson.version}`;
        try {
          // eslint-disable-next-line no-await-in-loop
          published += await publishRegistryPackage(publisher, workspacePackage, context);
        } catch (error) {
          const message = errorMessage(error);
          failures.push({ message, packageLabel, registry: publisher.name });
          writeLine(`Publish failed for ${packageLabel} with ${publisher.name}: ${message}`);
        }
      }
    }
  return { failures, published };
};

const publishFailureSummary = (failures: readonly PublishFailure[]): string =>
  [
    `Publish failed for ${failures.length.toString()} package registry operation(s):`,
    ...failures.map(
      ({ message, packageLabel, registry }) => `- ${packageLabel} with ${registry}: ${message}`,
    ),
  ].join("\n");

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
  const { failures, published } = await publishRegistries(
    publishersToRun,
    workspacePackages,
    context,
  );
  if (failures.length > 0) fail(publishFailureSummary(failures));
  if (!options.dryRun && options.registry === undefined && published > 0)
    runCommand(
      [bunExecutable, "run", "changeset", "tag"],
      packages.rootDir,
      "changeset tag failed after registry publish.",
    );
};

const main = async (): Promise<void> => {
  const command = runSync(program, { ...runOptions, args: process.argv.slice(2) });
  if (command.mode === "sync-jsr-metadata") return syncJsrMetadata();
  await publishPackages(command);
};

if (process.argv[1] === currentModulePath)
  await main().catch((error: unknown) => {
    if (process.exitCode !== undefined) return;
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown publish failure."}\n`,
    );
    process.exitCode = 1;
  });
