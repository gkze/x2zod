#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const publishablePathspecs = [
  "apps/*/bin/**",
  "apps/*/jsr.json",
  "apps/*/package.json",
  "apps/*/src/**",
  "packages/*/base.json",
  "packages/*/bin/**",
  "packages/*/jsr.json",
  "packages/*/package.json",
  "packages/*/schema/**",
  "packages/*/src/**",
] as const;

const versionMetadataPath = /^(?:apps|packages)\/[^/]+\/(?:jsr|package)\.json$/u;

const run = (command: string, args: readonly string[]): SpawnSyncReturns<string> => {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
};

const writeCommandOutput = (result: SpawnSyncReturns<string>): void => {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
};

const readCleanCommandOutput = (command: string, args: readonly string[]): string | undefined => {
  const result = run(command, args);

  if (result.status === 0) return result.stdout;

  writeCommandOutput(result);
  return undefined;
};

const parseJson = (source: string, path: string): unknown => {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${String(error)}`, { cause: error });
  }
};

const withoutVersion = (value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

  const copy = { ...(value as Record<string, unknown>) };
  delete copy["version"];
  return copy;
};

const readBaseFile = (base: string, path: string): string | undefined => {
  const result = run("git", ["show", `${base}:${path}`]);

  return result.status === 0 ? result.stdout : undefined;
};

const isVersionOnlyJsonChange = (base: string, path: string): boolean => {
  if (!versionMetadataPath.test(path)) return false;

  const baseContent = readBaseFile(base, path);

  if (baseContent === undefined) return false;

  const baseJson = parseJson(baseContent, `${base}:${path}`);
  const headJson = parseJson(readFileSync(path, "utf8"), path);

  return isDeepStrictEqual(withoutVersion(baseJson), withoutVersion(headJson));
};

const main = (): number => {
  const [base] = process.argv.slice(2);

  if (base === undefined) {
    process.stderr.write("Usage: bun scripts/changeset-required.ts <base-sha>\n");
    return 2;
  }

  const changedPayloadOutput = readCleanCommandOutput("git", [
    "diff",
    "--name-only",
    `${base}...HEAD`,
    "--",
    ...publishablePathspecs,
  ]);

  if (changedPayloadOutput === undefined) return 1;

  const changedPayload = changedPayloadOutput
    .split("\n")
    .filter((path): path is string => path.length > 0);

  if (changedPayload.length === 0) {
    process.stdout.write("No package payload changes.\n");
    return 0;
  }

  process.stdout.write(`${changedPayload.join("\n")}\n`);

  const changesetStatus = run("bun", ["run", "changeset", "status", `--since=${base}`]);

  if (changesetStatus.status === 0) {
    writeCommandOutput(changesetStatus);
    return 0;
  }

  if (changedPayload.every((path) => isVersionOnlyJsonChange(base, path))) {
    process.stdout.write(
      "Only package version metadata changed; the release changeset was already consumed.\n",
    );
    return 0;
  }

  writeCommandOutput(changesetStatus);
  return changesetStatus.status ?? 1;
};

process.exitCode = main();
