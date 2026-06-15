import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import type { MinimatchOptions } from "minimatch";
import { Minimatch } from "minimatch";
import type { ReadEntry } from "tar";
import * as tar from "tar";
import { match } from "ts-pattern";
import type { Entry as ZipEntry, ZipFile } from "yauzl";
import * as yauzl from "yauzl";

import type { DirectoryMerkleTree } from "./directory-merkle-tree";
import { createDirectoryMerkleTree } from "./directory-merkle-tree";
import { sha256Hex, sha256HexBytes } from "./hash";
import { resolveBuildInputPath } from "./paths";
import { archiveMaterializationRecipeSchema } from "./schemas";
import type {
  ArchiveMaterializationRecipe,
  BuildInputArchiveUnpackDeclaration,
  ResolvedBuildInputArchive,
  Sha256Hex,
} from "./schemas";

export interface DownloadedArchiveBuildInput {
  content: Buffer;
  input: ResolvedBuildInputArchive;
  sha256: Sha256Hex;
  sizeBytes: number;
}

export interface MaterializedArchiveBuildInput {
  input: ResolvedBuildInputArchive;
  materializationSha256: Sha256Hex;
  materialized: DirectoryMerkleTree;
  sourceSha256: Sha256Hex;
  sourceSizeBytes: number;
}

export interface PreparedArchiveBuildInput extends MaterializedArchiveBuildInput {
  extractedDirectory: string;
  temporaryRoot: string;
}

type ArchiveByteSignature = "gzip" | "tar" | "unknown" | "zip";

type ArchiveGlobMatchers = Readonly<{
  exclude: readonly Minimatch[];
  include: readonly Minimatch[];
}>;

const archiveGlobOptions = {
  dot: true,
  nocase: false,
  nonegate: true,
} as const satisfies MinimatchOptions;

const materializableTarEntryTypes = new Set(["ContiguousFile", "Directory", "File", "OldFile"]);

const tarMetadataEntryTypes = new Set([
  "ExtendedHeader",
  "GlobalExtendedHeader",
  "NextFileHasLongLinkpath",
  "NextFileHasLongPath",
  "OldExtendedHeader",
  "OldGnuLongPath",
]);

export const downloadArchiveBuildInput = async (
  input: ResolvedBuildInputArchive,
): Promise<DownloadedArchiveBuildInput> => {
  const response = await fetch(input.url);

  if (!response.ok)
    throw new Error(
      `Failed to fetch ${input.url} for ${input.unpack.directory}: ${response.status.toString()} ${response.statusText}`,
    );

  const content = Buffer.from(await response.arrayBuffer());

  return { content, input, sha256: sha256HexBytes(content), sizeBytes: content.byteLength };
};

export const hashArchiveMaterializationRecipe = (input: ResolvedBuildInputArchive): Sha256Hex =>
  sha256Hex(JSON.stringify(createArchiveMaterializationRecipe(input)));

export const prepareArchiveBuildInput = async (
  downloaded: DownloadedArchiveBuildInput,
): Promise<PreparedArchiveBuildInput> => {
  const { extractedDirectory, materialized, temporaryRoot } =
    await materializeArchiveToTempDirectory(downloaded);

  return {
    extractedDirectory,
    input: downloaded.input,
    materializationSha256: hashArchiveMaterializationRecipe(downloaded.input),
    materialized,
    sourceSha256: downloaded.sha256,
    sourceSizeBytes: downloaded.sizeBytes,
    temporaryRoot,
  };
};

const createArchiveMaterializationRecipe = (
  input: ResolvedBuildInputArchive,
): ArchiveMaterializationRecipe =>
  archiveMaterializationRecipeSchema.parse({
    archiveFormat: input.archiveFormat,
    type: "archive",
    unpack: {
      directory: input.unpack.directory,
      exclude: normalizeGlobPatterns(input.unpack.exclude),
      include: normalizeGlobPatterns(input.unpack.include),
      stripComponents: input.unpack.stripComponents,
    },
  });

const normalizeGlobPatterns = (patterns: readonly string[]): readonly string[] =>
  [...new Set(patterns)].sort();

const materializeArchiveToTempDirectory = async (
  downloaded: DownloadedArchiveBuildInput,
): Promise<{
  extractedDirectory: string;
  materialized: DirectoryMerkleTree;
  temporaryRoot: string;
}> => {
  assertArchiveFormatMatchesBytes(downloaded.input, downloaded.content);

  const temporaryRoot = await createArchiveTempRoot(downloaded.input);
  const archivePath = path.join(temporaryRoot, "source.archive");
  const extractedDirectory = path.join(temporaryRoot, "output");

  await writeFile(archivePath, downloaded.content);
  await extractArchive(archivePath, extractedDirectory, downloaded.input);

  return {
    extractedDirectory,
    materialized: await createDirectoryMerkleTree(extractedDirectory),
    temporaryRoot,
  };
};

const createArchiveTempRoot = async (input: ResolvedBuildInputArchive): Promise<string> => {
  const parentDirectory = path.dirname(input.absoluteDirectory);
  const baseName = path.basename(input.absoluteDirectory);

  await mkdir(parentDirectory, { recursive: true });

  return mkdtemp(path.join(parentDirectory, `.${baseName}.build-inputs-`));
};

const detectArchiveByteSignature = (content: Buffer): ArchiveByteSignature => {
  if (
    content.length >= 4 &&
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    (content[2] === 0x03 || content[2] === 0x05 || content[2] === 0x07) &&
    (content[3] === 0x04 || content[3] === 0x06 || content[3] === 0x08)
  )
    return "zip";

  if (content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b) return "gzip";

  if (content.length >= 262 && content.subarray(257, 262).toString("ascii") === "ustar")
    return "tar";

  return "unknown";
};

const assertArchiveFormatMatchesBytes = (
  input: ResolvedBuildInputArchive,
  content: Buffer,
): void => {
  const signature = detectArchiveByteSignature(content);
  const expectedSignature = match(input.archiveFormat)
    .with("tar.gz", () => "gzip" as const)
    .with("tar", () => "tar" as const)
    .with("zip", () => "zip" as const)
    .exhaustive();

  if (signature !== expectedSignature)
    throw new Error(
      `Build input ${input.id} declared ${input.archiveFormat} but downloaded bytes look like ${signature}`,
    );
};

const normalizeArchivePath = (archivePath: string, stripComponents: number): string | undefined => {
  if (
    archivePath.length === 0 ||
    archivePath.includes("\0") ||
    archivePath.includes("\\") ||
    archivePath.startsWith("/")
  )
    throw new Error(`Unsafe archive entry path '${archivePath}'`);

  const segments = archivePath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.some((segment) => segment === ".."))
    throw new Error(`Unsafe archive entry path '${archivePath}'`);

  const strippedSegments = segments.slice(stripComponents);

  return strippedSegments.length === 0 ? undefined : strippedSegments.join("/");
};

const createArchiveGlobMatchers = (
  unpack: BuildInputArchiveUnpackDeclaration,
): ArchiveGlobMatchers => ({
  exclude: unpack.exclude.map((pattern) => new Minimatch(pattern, archiveGlobOptions)),
  include: unpack.include.map((pattern) => new Minimatch(pattern, archiveGlobOptions)),
});

const matchesAnyGlob = (relativePath: string, matchers: readonly Minimatch[]): boolean =>
  matchers.some((matcher) => matcher.match(relativePath));

const shouldMaterializeArchivePath = (
  relativePath: string,
  matchers: ArchiveGlobMatchers,
): boolean => {
  const included = matchers.include.length === 0 || matchesAnyGlob(relativePath, matchers.include);

  if (!included) return false;

  return !matchesAnyGlob(relativePath, matchers.exclude);
};

const getArchiveOutputPath = (outputDir: string, relativePath: string): string =>
  resolveBuildInputPath(outputDir, relativePath, false);

const readTarEntryType = (entry: ReadEntry): string | undefined => entry.type;

const isTarMetadataEntry = (entry: ReadEntry): boolean => {
  const entryType = readTarEntryType(entry);
  return entryType === undefined ? false : tarMetadataEntryTypes.has(entryType);
};

const assertSupportedTarEntry = (
  input: ResolvedBuildInputArchive,
  entryPath: string,
  entry: ReadEntry,
): void => {
  const entryType = readTarEntryType(entry);

  if (entryType === undefined)
    throw new Error(
      `Build input ${input.id} contains unsupported tar entry ${entryPath} with unknown type`,
    );

  if (materializableTarEntryTypes.has(entryType)) return;

  throw new Error(
    `Build input ${input.id} contains unsupported tar entry ${entryPath} with type ${entryType}`,
  );
};

const extractTarArchive = async (
  archivePath: string,
  outputDir: string,
  input: ResolvedBuildInputArchive,
): Promise<void> => {
  const globMatchers = createArchiveGlobMatchers(input.unpack);

  await tar.extract({
    cwd: outputDir,
    file: archivePath,
    filter: (entryPath, entry) => {
      if (!("header" in entry))
        throw new Error(`Build input ${input.id} received an unexpected tar entry shape`);

      const relativePath = normalizeArchivePath(entryPath, input.unpack.stripComponents);

      if (relativePath === undefined) return false;
      if (!shouldMaterializeArchivePath(relativePath, globMatchers)) return false;
      if (isTarMetadataEntry(entry)) return false;

      assertSupportedTarEntry(input, entryPath, entry);
      return true;
    },
    noMtime: true,
    preserveOwner: false,
    preservePaths: false,
    strict: true,
    strip: input.unpack.stripComponents,
    unlink: true,
  });
};

const promisifiedOpenZipFile = promisify(yauzl.open) as (
  archivePath: string,
  options: yauzl.Options,
) => Promise<ZipFile | undefined>;

const openZipFile = async (archivePath: string): Promise<ZipFile> => {
  const zipFile = await promisifiedOpenZipFile(archivePath, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  if (zipFile === undefined) throw new Error(`Failed to open zip archive ${archivePath}`);
  return zipFile;
};

const openZipEntryStream = async (
  zipFile: ZipFile,
  entry: ZipEntry,
): Promise<NodeJS.ReadableStream> => {
  const openReadStream = promisify(zipFile.openReadStream.bind(zipFile)) as (
    entry: ZipEntry,
  ) => Promise<NodeJS.ReadableStream | undefined>;
  const stream = await openReadStream(entry);
  if (stream === undefined) throw new Error(`Failed to read zip entry ${entry.fileName}`);
  return stream;
};

const isZipDirectoryEntry = (entry: ZipEntry): boolean => entry.fileName.endsWith("/");

const getZipUnixMode = (entry: ZipEntry): number => (entry.externalFileAttributes >>> 16) & 0xffff;

const isZipSymlinkEntry = (entry: ZipEntry): boolean =>
  (getZipUnixMode(entry) & 0o170000) === 0o120000;

const getZipFileMode = (entry: ZipEntry): number =>
  (getZipUnixMode(entry) & 0o111) === 0 ? 0o644 : 0o755;

const materializeZipEntry = async (
  zipFile: ZipFile,
  entry: ZipEntry,
  outputDir: string,
  relativePath: string,
): Promise<void> => {
  const outputPath = getArchiveOutputPath(outputDir, relativePath);

  if (isZipDirectoryEntry(entry)) {
    await mkdir(outputPath, { recursive: true });
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  const fileMode = getZipFileMode(entry);
  const stream = await openZipEntryStream(zipFile, entry);

  await pipeline(stream, createWriteStream(outputPath, { mode: fileMode }));
  await chmod(outputPath, fileMode);
};

const extractZipArchive = async (
  archivePath: string,
  outputDir: string,
  input: ResolvedBuildInputArchive,
): Promise<void> => {
  const zipFile = await openZipFile(archivePath);
  const globMatchers = createArchiveGlobMatchers(input.unpack);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("end", () => {
      if (settled) return;
      settled = true;
      zipFile.close();
      resolve();
    });
    zipFile.on("entry", (entry: ZipEntry) => {
      void (async (): Promise<void> => {
        if (entry.isEncrypted())
          throw new Error(`Build input ${input.id} contains encrypted zip entry ${entry.fileName}`);

        if (isZipSymlinkEntry(entry))
          throw new Error(
            `Build input ${input.id} contains unsupported zip symlink ${entry.fileName}`,
          );

        const relativePath = normalizeArchivePath(entry.fileName, input.unpack.stripComponents);

        if (relativePath !== undefined && shouldMaterializeArchivePath(relativePath, globMatchers))
          await materializeZipEntry(zipFile, entry, outputDir, relativePath);

        if (!settled) zipFile.readEntry();
      })().catch(fail);
    });

    zipFile.readEntry();
  });
};

const extractArchive = async (
  archivePath: string,
  outputDir: string,
  input: ResolvedBuildInputArchive,
): Promise<void> => {
  await mkdir(outputDir, { recursive: true });

  if (input.archiveFormat === "zip") {
    await extractZipArchive(archivePath, outputDir, input);
    return;
  }

  await extractTarArchive(archivePath, outputDir, input);
};
