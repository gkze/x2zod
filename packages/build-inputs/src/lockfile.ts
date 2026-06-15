import { readFile } from "node:fs/promises";

import { hashArchiveMaterializationRecipe } from "./archive-materialization";
import type { MaterializedArchiveBuildInput } from "./archive-materialization";
import type { DirectoryMerkleTree } from "./directory-merkle-tree";
import { createDirectoryMerkleTree } from "./directory-merkle-tree";
import { isArchiveBuildInput } from "./guards";
import { sha256Hex } from "./hash";
import { sha256HexSchema } from "./schemas";
import type {
  BuildInputArchiveLockEntry,
  BuildInputResult,
  BuildInputsLock,
  BuildInputsLockEntry,
  DownloadedBuildInput,
  ResolvedBuildInput,
  ResolvedBuildInputArchive,
  ResolvedBuildInputFile,
  Sha256Hex,
} from "./schemas";

type LockComparableValue = number | string;

export const renderBuildInputsLock = (
  inputs: readonly ResolvedBuildInput[],
  existingLock: BuildInputsLock,
  downloadedInputs: readonly DownloadedBuildInput[],
  materializedArchives: readonly MaterializedArchiveBuildInput[],
): string => {
  const downloadedFileLockEntriesByUrl = new Map<string, BuildInputsLockEntry>(
    downloadedInputs.map((downloaded) => [
      downloaded.input.url,
      { sha256: downloaded.sha256, sizeBytes: downloaded.sizeBytes },
    ]),
  );
  const materializedArchivesById = new Map(
    materializedArchives.map((materialized) => [materialized.input.id, materialized]),
  );
  const lockUrls: BuildInputsLock["urls"] = {};
  const lockInputs: NonNullable<BuildInputsLock["inputs"]> = {};

  for (const input of inputs) {
    if (isArchiveBuildInput(input)) {
      const materialized = materializedArchivesById.get(input.id);

      if (materialized) {
        lockInputs[input.id] = {
          materialization: { sha256: materialized.materializationSha256 },
          materialized: {
            directoryCount: materialized.materialized.directoryCount,
            fileCount: materialized.materialized.fileCount,
            sha256: sha256HexSchema.parse(materialized.materialized.sha256),
            totalSizeBytes: materialized.materialized.totalSizeBytes,
          },
          source: {
            sha256: materialized.sourceSha256,
            sizeBytes: materialized.sourceSizeBytes,
            url: input.url,
          },
          type: "archive",
        };
        continue;
      }

      const existingEntry = existingLock.inputs?.[input.id];

      if (!existingEntry)
        throw new Error(
          `No lock entry exists for archive input ${input.id}. Re-run without --id or include ${input.id} with --update-lock.`,
        );

      assertReusableArchiveLockEntry(input, existingEntry);
      lockInputs[input.id] = existingEntry;
      continue;
    }

    const downloadedEntry = downloadedFileLockEntriesByUrl.get(input.url);

    if (downloadedEntry) {
      lockUrls[input.url] = downloadedEntry;
      continue;
    }

    const existingEntry = existingLock.urls[input.url];

    if (!existingEntry)
      throw new Error(
        `No lock entry exists for ${input.url}. Re-run without --id or include ${input.id} with --update-lock.`,
      );

    lockUrls[input.url] = existingEntry;
  }

  const lockContent =
    Object.keys(lockInputs).length === 0
      ? { urls: lockUrls, version: 1 }
      : { inputs: lockInputs, urls: lockUrls, version: 1 };

  return `${JSON.stringify(lockContent, null, 2)}\n`;
};

export const toFileBuildInputResult = (
  input: ResolvedBuildInputFile,
  lockEntry: BuildInputsLockEntry,
): BuildInputResult => ({
  id: input.id,
  path: input.path,
  sha256: lockEntry.sha256,
  sizeBytes: lockEntry.sizeBytes,
  url: input.url,
});

export const toArchiveBuildInputResult = (
  input: ResolvedBuildInputArchive,
  lockEntry: BuildInputArchiveLockEntry,
): BuildInputResult => ({
  id: input.id,
  materializationSha256: lockEntry.materialization.sha256,
  path: input.unpack.directory,
  sha256: lockEntry.materialized.sha256,
  sizeBytes: lockEntry.materialized.totalSizeBytes,
  sourceSha256: lockEntry.source.sha256,
  sourceSizeBytes: lockEntry.source.sizeBytes,
  totalSizeBytes: lockEntry.materialized.totalSizeBytes,
  type: "archive",
  url: input.url,
});

export const getArchiveLockEntry = (
  input: ResolvedBuildInputArchive,
  lock: BuildInputsLock,
): BuildInputArchiveLockEntry => {
  const lockEntry = lock.inputs?.[input.id];

  if (!lockEntry)
    throw new Error(
      `No lock entry exists for archive input ${input.id}. Run build-inputs --update-lock.`,
    );

  return lockEntry;
};

const formatLockValue = (value: LockComparableValue): string =>
  typeof value === "number" ? value.toString() : value;

const assertLockValue = <TValue extends LockComparableValue>(
  expected: TValue,
  actual: TValue,
  message: (expectedText: string, actualText: string) => string,
): void => {
  if (expected !== actual)
    throw new Error(message(formatLockValue(expected), formatLockValue(actual)));
};

export const verifyMaterializedArchivesAgainstLock = (
  materializedArchives: readonly MaterializedArchiveBuildInput[],
  lock: BuildInputsLock,
): readonly BuildInputResult[] => {
  const results: BuildInputResult[] = [];

  for (const materialized of materializedArchives) {
    const lockEntry = getArchiveLockEntry(materialized.input, lock);

    assertArchiveSourceMatchesLock(materialized.input, materialized, lockEntry);
    assertArchiveRecipeMatchesLock(
      materialized.input,
      materialized.materializationSha256,
      lockEntry,
    );
    assertArchiveMaterializedTreeMatchesLock(
      materialized.input,
      materialized.materialized,
      lockEntry,
    );

    results.push(toArchiveBuildInputResult(materialized.input, lockEntry));
  }

  return results;
};

export const verifyDownloadedBuildInputsAgainstLock = (
  downloadedInputs: readonly DownloadedBuildInput[],
  lock: BuildInputsLock,
): readonly BuildInputResult[] => {
  const results: BuildInputResult[] = [];

  for (const downloaded of downloadedInputs) {
    const lockEntry = lock.urls[downloaded.input.url];

    if (!lockEntry)
      throw new Error(
        `No lock entry exists for ${downloaded.input.url}. Run build-inputs --update-lock.`,
      );

    assertLockValue(
      lockEntry.sha256,
      downloaded.sha256,
      (expected, actual) =>
        `Build input ${downloaded.input.id} changed for ${downloaded.input.url}. Expected sha256 ${expected}, got ${actual}. Run build-inputs --update-lock if this source update is intentional.`,
    );

    results.push(toFileBuildInputResult(downloaded.input, lockEntry));
  }

  return results;
};

export const verifyLocalBuildInputsAgainstLock = async (
  inputs: readonly ResolvedBuildInput[],
  lock: BuildInputsLock,
): Promise<readonly BuildInputResult[]> => {
  const results: BuildInputResult[] = [];

  for (const input of inputs) {
    if (isArchiveBuildInput(input)) {
      results.push(await verifyLocalArchiveBuildInputAgainstLock(input, lock));
      continue;
    }

    const lockEntry = lock.urls[input.url];

    if (!lockEntry)
      throw new Error(`No lock entry exists for ${input.url}. Run build-inputs --update-lock.`);

    const content = await readFile(input.absolutePath, "utf8");
    const localSha256 = sha256Hex(content);
    const localSizeBytes = Buffer.byteLength(content, "utf8");

    assertLockValue(
      lockEntry.sha256,
      localSha256,
      (expected, actual) =>
        `Local build input ${input.id} at ${input.path} does not match lock. Expected sha256 ${expected}, got ${actual}.`,
    );
    assertLockValue(
      lockEntry.sizeBytes,
      localSizeBytes,
      (expected, actual) =>
        `Local build input ${input.id} at ${input.path} does not match lock. Expected ${expected} bytes, got ${actual}.`,
    );

    results.push(toFileBuildInputResult(input, lockEntry));
  }

  return results;
};

const assertReusableArchiveLockEntry = (
  input: ResolvedBuildInputArchive,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  const materializationSha256 = hashArchiveMaterializationRecipe(input);

  if (lockEntry.source.url !== input.url)
    throw new Error(
      `Build input ${input.id} source URL changed. ` +
        `Expected ${lockEntry.source.url}, got ${input.url}. ` +
        `Re-run without --id or include ${input.id} with --update-lock.`,
    );

  if (lockEntry.materialization.sha256 !== materializationSha256)
    throw new Error(
      `Build input ${input.id} materialization changed. ` +
        `Expected sha256 ${lockEntry.materialization.sha256}, ` +
        `got ${materializationSha256}. Re-run without --id or include ` +
        `${input.id} with --update-lock.`,
    );
};

const assertArchiveRecipeMatchesLock = (
  input: ResolvedBuildInputArchive,
  materializationSha256: Sha256Hex,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  assertLockValue(
    lockEntry.materialization.sha256,
    materializationSha256,
    (expected, actual) =>
      `Build input ${input.id} materialization recipe changed. Expected sha256 ${expected}, got ${actual}. Run build-inputs --update-lock if this unpack policy update is intentional.`,
  );
};

const assertArchiveMaterializedTreeMatchesLock = (
  input: ResolvedBuildInputArchive,
  materialized: DirectoryMerkleTree,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  assertLockValue(
    lockEntry.materialized.sha256,
    materialized.sha256,
    (expected, actual) =>
      `Build input ${input.id} materialized tree changed. Expected sha256 ${expected}, got ${actual}. Run build-inputs --update-lock if this output update is intentional.`,
  );
  assertLockValue(
    lockEntry.materialized.fileCount,
    materialized.fileCount,
    (expected, actual) =>
      `Build input ${input.id} materialized file count changed. Expected ${expected}, got ${actual}.`,
  );
  assertLockValue(
    lockEntry.materialized.directoryCount,
    materialized.directoryCount,
    (expected, actual) =>
      `Build input ${input.id} materialized directory count changed. Expected ${expected}, got ${actual}.`,
  );
  assertLockValue(
    lockEntry.materialized.totalSizeBytes,
    materialized.totalSizeBytes,
    (expected, actual) =>
      `Build input ${input.id} materialized byte count changed. Expected ${expected}, got ${actual}.`,
  );
};

const assertArchiveSourceMatchesLock = (
  input: ResolvedBuildInputArchive,
  materialized: MaterializedArchiveBuildInput,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  assertLockValue(
    lockEntry.source.url,
    input.url,
    (expected, actual) =>
      `Build input ${input.id} source URL changed. Expected ${expected}, got ${actual}. Run build-inputs --update-lock if this source update is intentional.`,
  );
  assertLockValue(
    lockEntry.source.sha256,
    materialized.sourceSha256,
    (expected, actual) =>
      `Build input ${input.id} source archive changed for ${input.url}. Expected sha256 ${expected}, got ${actual}. Run build-inputs --update-lock if this source update is intentional.`,
  );
  assertLockValue(
    lockEntry.source.sizeBytes,
    materialized.sourceSizeBytes,
    (expected, actual) =>
      `Build input ${input.id} source archive size changed for ${input.url}. Expected ${expected} bytes, got ${actual}.`,
  );
};

const verifyLocalArchiveBuildInputAgainstLock = async (
  input: ResolvedBuildInputArchive,
  lock: BuildInputsLock,
): Promise<BuildInputResult> => {
  const lockEntry = getArchiveLockEntry(input, lock);
  const materializationSha256 = hashArchiveMaterializationRecipe(input);

  assertArchiveRecipeMatchesLock(input, materializationSha256, lockEntry);

  assertLockValue(
    lockEntry.source.url,
    input.url,
    (expected, actual) =>
      `Build input ${input.id} source URL changed. Expected ${expected}, got ${actual}. Run build-inputs --update-lock if this source update is intentional.`,
  );

  assertArchiveMaterializedTreeMatchesLock(
    input,
    await createDirectoryMerkleTree(input.absoluteDirectory),
    lockEntry,
  );

  return toArchiveBuildInputResult(input, lockEntry);
};
