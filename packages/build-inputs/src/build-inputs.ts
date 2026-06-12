/// <reference path="./tar-v6.d.ts" />

import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { MIMEType } from "node:util";

import type { MinimatchOptions } from "minimatch";
import { Minimatch } from "minimatch";
import type { FileStat } from "tar-v6";
import * as tar from "tar-v6";
import { match, P } from "ts-pattern";
import type { JsonValue } from "type-fest";
import type { Entry as ZipEntry, ZipFile } from "yauzl";
import * as yauzl from "yauzl";
import { z } from "zod/v4";

import type { DirectoryMerkleTree } from "./directory-merkle-tree";
import { createDirectoryMerkleTree } from "./directory-merkle-tree";
import { formatWithOxfmt } from "./oxfmt";

export const buildInputFormats = ["json", "markdown", "text"] as const;
export const buildInputArchiveFormats = ["tar", "tar.gz", "zip"] as const;
export const buildInputsModes = ["check", "materialize", "update-lock"] as const;

const defaultConfigPath = "build-inputs.json";
const defaultLockfilePath = "build-inputs.lock.json";
const jsonValueSchema: z.ZodType<JsonValue> = z.json();
const buildInputIdPattern = /^[a-z0-9][a-z0-9-]*$/;

const canParseSha256Hex = (value: string): boolean => {
  if (value.length !== 64 || value !== value.toLowerCase()) return false;

  const bytes = Buffer.from(value, "hex");

  return bytes.length === 32 && bytes.toString("hex") === value;
};

export const buildInputFormatSchema = z.enum(buildInputFormats);
export const buildInputArchiveFormatSchema = z.enum(buildInputArchiveFormats);
export const buildInputsModeSchema = z.enum(buildInputsModes);
export const buildInputIdSchema = z
  .string()
  .regex(buildInputIdPattern, {
    message:
      "Build input ids must start with a lowercase ASCII letter or digit " +
      "and contain only lowercase ASCII letters, digits, and hyphens",
  })
  .brand<"BuildInputId">();
export const sha256HexSchema = z
  .string()
  .refine(canParseSha256Hex, { message: "Expected a lowercase hex-encoded SHA-256 digest" })
  .brand<"Sha256Hex">();

const globPatternSchema = z.string().min(1);

export const buildInputFileDeclarationSchema = z
  .object({
    format: buildInputFormatSchema.optional(),
    id: buildInputIdSchema,
    path: z.string().min(1),
    type: z.literal("file").optional(),
    url: z.url(),
  })
  .strict();

export const buildInputArchiveUnpackDeclarationSchema = z
  .object({
    directory: z.string().min(1),
    exclude: z.array(globPatternSchema).default([]),
    include: z.array(globPatternSchema).default([]),
    stripComponents: z.number().int().nonnegative().default(0),
  })
  .strict();

export const buildInputArchiveDeclarationSchema = z
  .object({
    archiveFormat: buildInputArchiveFormatSchema,
    id: buildInputIdSchema,
    type: z.literal("archive"),
    unpack: buildInputArchiveUnpackDeclarationSchema,
    url: z.url(),
  })
  .strict();

export const buildInputDeclarationSchema = z.union([
  buildInputArchiveDeclarationSchema,
  buildInputFileDeclarationSchema,
]);

export const buildInputsDeclarationSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    inputs: z.array(buildInputDeclarationSchema).min(1),
    version: z.literal(1),
  })
  .strict();

export const buildInputsLockEntrySchema = z
  .object({ sha256: sha256HexSchema, sizeBytes: z.number().int().nonnegative() })
  .strict();

export const buildInputArchiveLockEntrySchema = z
  .object({
    materialization: z.object({ sha256: sha256HexSchema }).strict(),
    materialized: z
      .object({
        directoryCount: z.number().int().nonnegative(),
        fileCount: z.number().int().nonnegative(),
        sha256: sha256HexSchema,
        totalSizeBytes: z.number().int().nonnegative(),
      })
      .strict(),
    source: buildInputsLockEntrySchema.extend({ url: z.url() }),
    type: z.literal("archive"),
  })
  .strict();

export const buildInputsLockSchema = z
  .object({
    inputs: z.record(buildInputIdSchema, buildInputArchiveLockEntrySchema).optional(),
    urls: z.record(z.url(), buildInputsLockEntrySchema),
    version: z.literal(1),
  })
  .strict();

export const buildInputsOptionsSchema = z
  .object({
    configPath: z.string().min(1).optional(),
    ids: z.array(buildInputIdSchema).optional(),
    lockfilePath: z.string().min(1).optional(),
    mode: buildInputsModeSchema.default("materialize"),
    rootDir: z.string().min(1).optional(),
  })
  .strict();

export const resolvedBuildInputFileSchema = buildInputFileDeclarationSchema
  .extend({ absolutePath: z.string().min(1) })
  .strict();

export const resolvedBuildInputArchiveSchema = buildInputArchiveDeclarationSchema
  .extend({ absoluteDirectory: z.string().min(1) })
  .strict();

export const resolvedBuildInputSchema = z.union([
  resolvedBuildInputArchiveSchema,
  resolvedBuildInputFileSchema,
]);

export const archiveMaterializationRecipeSchema = buildInputArchiveDeclarationSchema
  .pick({ archiveFormat: true, unpack: true })
  .extend({ type: z.literal("archive") });

export const buildInputFileResultSchema = z
  .object({
    id: buildInputIdSchema,
    path: z.string().min(1),
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
    type: z.literal("file").optional(),
    url: z.url(),
  })
  .strict();

export const buildInputArchiveResultSchema = z
  .object({
    id: buildInputIdSchema,
    materializationSha256: sha256HexSchema,
    path: z.string().min(1),
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
    sourceSha256: sha256HexSchema,
    sourceSizeBytes: z.number().int().nonnegative(),
    totalSizeBytes: z.number().int().nonnegative(),
    type: z.literal("archive"),
    url: z.url(),
  })
  .strict();

export const buildInputResultSchema = z.union([
  buildInputArchiveResultSchema,
  buildInputFileResultSchema,
]);

export const buildInputsResultSchema = z
  .object({
    inputs: z.array(buildInputResultSchema),
    lockfilePath: z.string().min(1),
    lockfileUpdated: z.boolean(),
    mode: buildInputsModeSchema,
  })
  .strict();

const downloadedBuildInputSchema = z
  .object({
    content: z.string(),
    input: resolvedBuildInputFileSchema,
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export type BuildInputId = z.infer<typeof buildInputIdSchema>;
export type BuildInputFormat = z.infer<typeof buildInputFormatSchema>;
export type BuildInputArchiveFormat = z.infer<typeof buildInputArchiveFormatSchema>;
export type BuildInputsMode = z.infer<typeof buildInputsModeSchema>;
export type Sha256Hex = z.infer<typeof sha256HexSchema>;
export type BuildInputArchiveDeclaration = z.infer<typeof buildInputArchiveDeclarationSchema>;
export type BuildInputArchiveUnpackDeclaration = z.infer<
  typeof buildInputArchiveUnpackDeclarationSchema
>;
export type BuildInputDeclaration = z.infer<typeof buildInputDeclarationSchema>;
export type BuildInputFileDeclaration = z.infer<typeof buildInputFileDeclarationSchema>;
export type BuildInputsDeclaration = z.infer<typeof buildInputsDeclarationSchema>;
export type BuildInputArchiveLockEntry = z.infer<typeof buildInputArchiveLockEntrySchema>;
export type BuildInputsLockEntry = z.infer<typeof buildInputsLockEntrySchema>;
export type BuildInputsLock = z.infer<typeof buildInputsLockSchema>;
export type BuildInputsOptions = z.input<typeof buildInputsOptionsSchema>;
export type ResolvedBuildInputArchive = z.infer<typeof resolvedBuildInputArchiveSchema>;
export type ResolvedBuildInputFile = z.infer<typeof resolvedBuildInputFileSchema>;
export type ResolvedBuildInput = z.infer<typeof resolvedBuildInputSchema>;
export type BuildInputResult = z.infer<typeof buildInputResultSchema>;
export type BuildInputsResult = z.infer<typeof buildInputsResultSchema>;

type ArchiveMaterializationRecipe = z.infer<typeof archiveMaterializationRecipeSchema>;
type DownloadedBuildInput = z.infer<typeof downloadedBuildInputSchema>;

interface DownloadedArchiveBuildInput {
  content: Buffer;
  input: ResolvedBuildInputArchive;
  sha256: Sha256Hex;
  sizeBytes: number;
}

interface MaterializedArchiveBuildInput {
  input: ResolvedBuildInputArchive;
  materializationSha256: Sha256Hex;
  materialized: DirectoryMerkleTree;
  sourceSha256: Sha256Hex;
  sourceSizeBytes: number;
}

interface PreparedArchiveBuildInput extends MaterializedArchiveBuildInput {
  extractedDirectory: string;
  temporaryRoot: string;
}

const emptyBuildInputsLock = buildInputsLockSchema.parse({ urls: {}, version: 1 });

const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;

const sha256Hex = (content: string): Sha256Hex =>
  sha256HexSchema.parse(createHash("sha256").update(content, "utf8").digest("hex"));

const sha256HexBytes = (content: Buffer): Sha256Hex =>
  sha256HexSchema.parse(createHash("sha256").update(content).digest("hex"));

const jsonMediaTypes: ReadonlySet<string> = new Set([
  "application/json",
] as const satisfies readonly string[]);
const markdownMediaTypes: ReadonlySet<string> = new Set([
  "text/markdown",
  "text/x-markdown",
] as const satisfies readonly string[]);
const jsonExtensions = new Set(["json", "map"]);
const markdownExtensions = new Set(["markdown", "md", "mkd"]);

const parseMediaType = (contentType: string | null): string | undefined => {
  if (contentType === null || contentType.length === 0) return undefined;

  try {
    return new MIMEType(contentType).essence.toLowerCase();
  } catch {
    return undefined;
  }
};

const detectFormatFromContentType = (contentType: string | null): BuildInputFormat | undefined => {
  const mediaType = parseMediaType(contentType);
  if (mediaType === undefined) return undefined;

  if (jsonMediaTypes.has(mediaType) || mediaType.endsWith("+json")) return "json";
  if (markdownMediaTypes.has(mediaType)) return "markdown";

  return undefined;
};

const detectFormatFromPath = (filePath: string): BuildInputFormat => {
  const extension = path.extname(filePath).slice(1).toLowerCase();

  return match(extension)
    .with("", () => "text" as const)
    .with(
      P.when((ext) => jsonExtensions.has(ext)),
      () => "json" as const,
    )
    .with(
      P.when((ext) => markdownExtensions.has(ext)),
      () => "markdown" as const,
    )
    .otherwise(() => "text" as const);
};

const isArchiveBuildInput = (input: ResolvedBuildInput): input is ResolvedBuildInputArchive =>
  input.type === "archive";

const isFileBuildInput = (input: ResolvedBuildInput): input is ResolvedBuildInputFile =>
  input.type !== "archive";

const resolveDownloadedFormat = (
  input: ResolvedBuildInputFile,
  response: Response,
): BuildInputFormat =>
  input.format ??
  detectFormatFromContentType(response.headers.get("content-type")) ??
  detectFormatFromPath(input.absolutePath);

const getStructuredFormatPath = (
  input: ResolvedBuildInputFile,
  format: Exclude<BuildInputFormat, "text">,
): string => {
  const extension = path.extname(input.absolutePath);

  return match({ format, extension })
    .with({ format: "json", extension: P.not(".json") }, () => `${input.absolutePath}.json`)
    .with(
      { format: "markdown", extension: P.not(P.union(".md", ".markdown")) },
      () => `${input.absolutePath}.md`,
    )
    .otherwise(() => input.absolutePath);
};

const parseJson = (content: string): JsonValue => jsonValueSchema.parse(JSON.parse(content));

const formatDownloadedJsonContent = (content: string): string =>
  `${JSON.stringify(parseJson(content), null, 2)}\n`;

const formatDownloadedContent = (
  input: ResolvedBuildInputFile,
  content: string,
  format: Exclude<BuildInputFormat, "text">,
): string =>
  format === "json"
    ? formatDownloadedJsonContent(content)
    : formatWithOxfmt(content, getStructuredFormatPath(input, format));

const readJsonFile = async (filePath: string): Promise<JsonValue> =>
  parseJson(await readFile(filePath, "utf8"));

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveBuildInputPath = (rootDir: string, filePath: string, mustExist: boolean): string => {
  const resolved = path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Build input path escapes root: ${filePath}`);
  if (mustExist && !existsSync(resolved))
    throw new Error(`Build input path does not exist: ${filePath}`);

  return resolved;
};

const readBuildInputsDeclaration = async (configPath: string): Promise<BuildInputsDeclaration> =>
  buildInputsDeclarationSchema.parse(await readJsonFile(configPath));

const readBuildInputsLock = async (lockfilePath: string): Promise<BuildInputsLock> => {
  if (!(await pathExists(lockfilePath)))
    throw new Error(
      `Missing build inputs lockfile at ${lockfilePath}. Run build-inputs --update-lock first.`,
    );

  return buildInputsLockSchema.parse(await readJsonFile(lockfilePath));
};

const readExistingBuildInputsLockOrDefault = async (
  lockfilePath: string,
): Promise<BuildInputsLock> =>
  (await pathExists(lockfilePath))
    ? buildInputsLockSchema.parse(await readJsonFile(lockfilePath))
    : emptyBuildInputsLock;

const resolveBuildInput = (rootDir: string, input: BuildInputDeclaration): ResolvedBuildInput =>
  match(input)
    .with({ type: "archive" }, (archiveInput) => ({
      ...archiveInput,
      absoluteDirectory: resolveBuildInputPath(rootDir, archiveInput.unpack.directory, false),
    }))
    .otherwise((fileInput) => ({
      ...fileInput,
      absolutePath: resolveBuildInputPath(rootDir, fileInput.path, false),
    }));

const getConfiguredBuildInputFormat = (input: ResolvedBuildInputFile): BuildInputFormat =>
  input.format ?? detectFormatFromPath(input.absolutePath);

const getBuildInputOutputPath = (input: ResolvedBuildInput): string =>
  isArchiveBuildInput(input) ? input.absoluteDirectory : input.absolutePath;

const getBuildInputDisplayPath = (input: ResolvedBuildInput): string =>
  isArchiveBuildInput(input) ? input.unpack.directory : input.path;

const isChildBuildInputPath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const buildInputPathsOverlap = (leftPath: string, rightPath: string): boolean =>
  leftPath === rightPath ||
  isChildBuildInputPath(leftPath, rightPath) ||
  isChildBuildInputPath(rightPath, leftPath);

const assertUniqueBuildInputs = (inputs: readonly ResolvedBuildInput[]): void => {
  const ids = new Set<BuildInputId>();
  const outputPaths: { displayPath: string; outputPath: string }[] = [];
  const formatsByUrl = new Map<string, BuildInputFormat>();

  for (const input of inputs) {
    if (ids.has(input.id)) throw new Error(`Build input id '${input.id}' is declared twice`);
    ids.add(input.id);

    const displayPath = getBuildInputDisplayPath(input);
    const outputPath = getBuildInputOutputPath(input);
    const overlappingPath = outputPaths.find((seenPath) =>
      buildInputPathsOverlap(seenPath.outputPath, outputPath),
    );

    if (overlappingPath?.outputPath === outputPath)
      throw new Error(`Build input path '${displayPath}' is declared more than once`);

    if (overlappingPath)
      throw new Error(
        `Build input path '${displayPath}' overlaps '${overlappingPath.displayPath}'`,
      );
    outputPaths.push({ displayPath, outputPath });

    if (isArchiveBuildInput(input)) continue;

    const format = getConfiguredBuildInputFormat(input);
    const existingFormat = formatsByUrl.get(input.url);

    if (existingFormat && existingFormat !== format)
      throw new Error(
        `Build input '${input.url}' is declared with both '${existingFormat}' and '${format}' formats`,
      );

    formatsByUrl.set(input.url, format);
  }
};

const readAndResolveBuildInputs = async (
  rootDir: string,
  configPath: string,
): Promise<readonly ResolvedBuildInput[]> => {
  const resolvedConfigPath = resolveBuildInputPath(rootDir, configPath, true);
  const declaration = await readBuildInputsDeclaration(resolvedConfigPath);
  const inputs = declaration.inputs.map((input) => resolveBuildInput(rootDir, input));
  assertUniqueBuildInputs(inputs);

  return inputs;
};

export const readDeclaredBuildInputs = (
  rootDir = process.cwd(),
  configPath = defaultConfigPath,
): Promise<readonly ResolvedBuildInput[]> =>
  readAndResolveBuildInputs(path.resolve(rootDir), configPath);

const selectBuildInputs = (
  inputs: readonly ResolvedBuildInput[],
  ids: readonly BuildInputId[] | undefined,
): readonly ResolvedBuildInput[] => {
  if (ids === undefined || ids.length === 0) return inputs;

  const requestedIds = new Set(ids);
  const selected = inputs.filter((input) => requestedIds.has(input.id));
  const selectedIds = new Set<string>(selected.map((input) => input.id));
  const missingIds = [...requestedIds].filter((id) => !selectedIds.has(id));

  if (missingIds.length > 0)
    throw new Error(`Unknown build input id(s): ${missingIds.sort().join(", ")}`);

  return selected;
};

const expandBuildInputSelectionByUrl = (
  inputs: readonly ResolvedBuildInput[],
  selectedInputs: readonly ResolvedBuildInput[],
): readonly ResolvedBuildInput[] => {
  if (selectedInputs.length === inputs.length) return selectedInputs;

  const selectedIds = new Set(selectedInputs.map((input) => input.id));
  const selectedUrls = new Set(selectedInputs.map((input) => input.url));

  return inputs.filter((input) => selectedIds.has(input.id) || selectedUrls.has(input.url));
};

const normalizeDownloadedContent = async (
  input: ResolvedBuildInputFile,
  response: Response,
): Promise<string> => {
  const responseText = await response.text();
  const format = resolveDownloadedFormat(input, response);

  return match(format)
    .with("json", () =>
      formatDownloadedContent(
        input,
        `${JSON.stringify(parseJson(responseText), null, 2)}\n`,
        "json",
      ),
    )
    .with("markdown", () =>
      formatDownloadedContent(input, ensureTrailingNewline(responseText), "markdown"),
    )
    .otherwise(() => ensureTrailingNewline(responseText));
};

const downloadBuildInput = async (input: ResolvedBuildInputFile): Promise<DownloadedBuildInput> => {
  const response = await fetch(input.url);

  if (!response.ok)
    throw new Error(
      `Failed to fetch ${input.url} for ${input.path}: ${response.status.toString()} ${response.statusText}`,
    );

  const content = await normalizeDownloadedContent(input, response);

  return {
    content,
    input,
    sha256: sha256Hex(content),
    sizeBytes: Buffer.byteLength(content, "utf8"),
  };
};

const downloadArchiveBuildInput = async (
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

type ArchiveByteSignature = "gzip" | "tar" | "unknown" | "zip";

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

const normalizeGlobPatterns = (patterns: readonly string[]): readonly string[] =>
  [...new Set(patterns)].sort();

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

const hashArchiveMaterializationRecipe = (input: ResolvedBuildInputArchive): Sha256Hex =>
  sha256Hex(JSON.stringify(createArchiveMaterializationRecipe(input)));

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

const archiveGlobOptions = {
  dot: true,
  nocase: false,
  nonegate: true,
} as const satisfies MinimatchOptions;

interface ArchiveGlobMatchers {
  exclude: readonly Minimatch[];
  include: readonly Minimatch[];
}

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

const readTarEntryType = (entry: FileStat): string | undefined => entry.header.type;

const materializableTarEntryTypes = new Set(["ContiguousFile", "Directory", "File", "OldFile"]);

const tarMetadataEntryTypes = new Set([
  "ExtendedHeader",
  "GlobalExtendedHeader",
  "NextFileHasLongLinkpath",
  "NextFileHasLongPath",
  "OldExtendedHeader",
  "OldGnuLongPath",
]);

const isTarMetadataEntry = (entry: FileStat): boolean => {
  const entryType = readTarEntryType(entry);
  return entryType === undefined ? false : tarMetadataEntryTypes.has(entryType);
};

const assertSupportedTarEntry = (
  input: ResolvedBuildInputArchive,
  entryPath: string,
  entry: FileStat,
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

const openZipFile = (archivePath: string): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zipFile) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(zipFile);
      },
    );
  });

const openZipEntryStream = (zipFile: ZipFile, entry: ZipEntry): Promise<NodeJS.ReadableStream> =>
  new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stream);
    });
  });

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

const createArchiveTempRoot = async (input: ResolvedBuildInputArchive): Promise<string> => {
  const parentDirectory = path.dirname(input.absoluteDirectory);
  const baseName = path.basename(input.absoluteDirectory);

  await mkdir(parentDirectory, { recursive: true });

  return mkdtemp(path.join(parentDirectory, `.${baseName}.build-inputs-`));
};

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

const replaceDirectory = async (
  targetDirectory: string,
  sourceDirectory: string,
): Promise<void> => {
  await rm(targetDirectory, { force: true, recursive: true });
  await rename(sourceDirectory, targetDirectory);
};

const prepareArchiveBuildInput = async (
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

const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid.toString()}.tmp`;

  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const materializeDownloadedBuildInputs = async (
  downloadedInputs: readonly DownloadedBuildInput[],
): Promise<void> => {
  for (const downloaded of downloadedInputs)
    await writeFileAtomic(downloaded.input.absolutePath, downloaded.content);
};

const materializePreparedArchiveBuildInputs = async (
  preparedArchives: readonly PreparedArchiveBuildInput[],
): Promise<void> => {
  for (const archive of preparedArchives)
    await replaceDirectory(archive.input.absoluteDirectory, archive.extractedDirectory);
};

const materializePreparedBuildInputs = async (
  downloadedInputs: readonly DownloadedBuildInput[],
  preparedArchives: readonly PreparedArchiveBuildInput[],
): Promise<void> => {
  await materializeDownloadedBuildInputs(downloadedInputs);
  await materializePreparedArchiveBuildInputs(preparedArchives);
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

const renderBuildInputsLock = (
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

const toFileBuildInputResult = (
  input: ResolvedBuildInputFile,
  lockEntry: BuildInputsLockEntry,
): BuildInputResult => ({
  id: input.id,
  path: input.path,
  sha256: lockEntry.sha256,
  sizeBytes: lockEntry.sizeBytes,
  url: input.url,
});

const toArchiveBuildInputResult = (
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

const getArchiveLockEntry = (
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

const assertArchiveRecipeMatchesLock = (
  input: ResolvedBuildInputArchive,
  materializationSha256: Sha256Hex,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  if (lockEntry.materialization.sha256 !== materializationSha256)
    throw new Error(
      `Build input ${input.id} materialization recipe changed. Expected sha256 ${lockEntry.materialization.sha256}, got ${materializationSha256}. Run build-inputs --update-lock if this unpack policy update is intentional.`,
    );
};

const assertArchiveMaterializedTreeMatchesLock = (
  input: ResolvedBuildInputArchive,
  materialized: DirectoryMerkleTree,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  if (lockEntry.materialized.sha256 !== materialized.sha256)
    throw new Error(
      `Build input ${input.id} materialized tree changed. Expected sha256 ${lockEntry.materialized.sha256}, got ${materialized.sha256}. Run build-inputs --update-lock if this output update is intentional.`,
    );

  if (lockEntry.materialized.fileCount !== materialized.fileCount)
    throw new Error(
      `Build input ${input.id} materialized file count changed. Expected ${lockEntry.materialized.fileCount.toString()}, got ${materialized.fileCount.toString()}.`,
    );

  if (lockEntry.materialized.directoryCount !== materialized.directoryCount)
    throw new Error(
      `Build input ${input.id} materialized directory count changed. Expected ${lockEntry.materialized.directoryCount.toString()}, got ${materialized.directoryCount.toString()}.`,
    );

  if (lockEntry.materialized.totalSizeBytes !== materialized.totalSizeBytes)
    throw new Error(
      `Build input ${input.id} materialized byte count changed. Expected ${lockEntry.materialized.totalSizeBytes.toString()}, got ${materialized.totalSizeBytes.toString()}.`,
    );
};

const assertArchiveSourceMatchesLock = (
  input: ResolvedBuildInputArchive,
  materialized: MaterializedArchiveBuildInput,
  lockEntry: BuildInputArchiveLockEntry,
): void => {
  if (lockEntry.source.url !== input.url)
    throw new Error(
      `Build input ${input.id} source URL changed. Expected ${lockEntry.source.url}, got ${input.url}. Run build-inputs --update-lock if this source update is intentional.`,
    );

  if (lockEntry.source.sha256 !== materialized.sourceSha256)
    throw new Error(
      `Build input ${input.id} source archive changed for ${input.url}. Expected sha256 ${lockEntry.source.sha256}, got ${materialized.sourceSha256}. Run build-inputs --update-lock if this source update is intentional.`,
    );

  if (lockEntry.source.sizeBytes !== materialized.sourceSizeBytes)
    throw new Error(
      `Build input ${input.id} source archive size changed for ${input.url}. Expected ${lockEntry.source.sizeBytes.toString()} bytes, got ${materialized.sourceSizeBytes.toString()}.`,
    );
};

const verifyMaterializedArchivesAgainstLock = (
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

const verifyDownloadedBuildInputsAgainstLock = (
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

    if (lockEntry.sha256 !== downloaded.sha256)
      throw new Error(
        `Build input ${downloaded.input.id} changed for ${downloaded.input.url}. Expected sha256 ${lockEntry.sha256}, got ${downloaded.sha256}. Run build-inputs --update-lock if this source update is intentional.`,
      );

    results.push(toFileBuildInputResult(downloaded.input, lockEntry));
  }

  return results;
};

const verifyLocalArchiveBuildInputAgainstLock = async (
  input: ResolvedBuildInputArchive,
  lock: BuildInputsLock,
): Promise<BuildInputResult> => {
  const lockEntry = getArchiveLockEntry(input, lock);
  const materializationSha256 = hashArchiveMaterializationRecipe(input);

  assertArchiveRecipeMatchesLock(input, materializationSha256, lockEntry);

  if (lockEntry.source.url !== input.url)
    throw new Error(
      `Build input ${input.id} source URL changed. Expected ${lockEntry.source.url}, got ${input.url}. Run build-inputs --update-lock if this source update is intentional.`,
    );

  assertArchiveMaterializedTreeMatchesLock(
    input,
    await createDirectoryMerkleTree(input.absoluteDirectory),
    lockEntry,
  );

  return toArchiveBuildInputResult(input, lockEntry);
};

const verifyLocalBuildInputsAgainstLock = async (
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

    if (lockEntry.sha256 !== localSha256)
      throw new Error(
        `Local build input ${input.id} at ${input.path} does not match lock. Expected sha256 ${lockEntry.sha256}, got ${localSha256}.`,
      );

    if (lockEntry.sizeBytes !== localSizeBytes)
      throw new Error(
        `Local build input ${input.id} at ${input.path} does not match lock. Expected ${lockEntry.sizeBytes.toString()} bytes, got ${localSizeBytes.toString()}.`,
      );

    results.push(toFileBuildInputResult(input, lockEntry));
  }

  return results;
};

const createResult = (
  inputs: readonly BuildInputResult[],
  lockfilePath: string,
  lockfileUpdated: boolean,
  mode: BuildInputsMode,
): BuildInputsResult => ({ inputs: [...inputs], lockfilePath, lockfileUpdated, mode });

const orderResultsByInputs = (
  inputs: readonly ResolvedBuildInput[],
  results: readonly BuildInputResult[],
): readonly BuildInputResult[] => {
  const resultsById = new Map(results.map((result) => [result.id, result]));

  return inputs.map((input) => {
    const result = resultsById.get(input.id);

    if (!result) throw new Error(`Missing build input result for ${input.id}`);

    return result;
  });
};

export const buildInputs = async (options: BuildInputsOptions = {}): Promise<BuildInputsResult> => {
  const {
    configPath = defaultConfigPath,
    ids,
    lockfilePath = defaultLockfilePath,
    mode,
    rootDir = process.cwd(),
  } = buildInputsOptionsSchema.parse(options);
  const normalizedRootDir = path.resolve(rootDir);
  const resolvedLockfilePath = resolveBuildInputPath(normalizedRootDir, lockfilePath, false);
  const inputs = await readAndResolveBuildInputs(normalizedRootDir, configPath);
  const requestedInputs = selectBuildInputs(inputs, ids);
  const selectedInputs =
    mode === "update-lock"
      ? expandBuildInputSelectionByUrl(inputs, requestedInputs)
      : requestedInputs;
  const existingLock =
    mode === "update-lock"
      ? await readExistingBuildInputsLockOrDefault(resolvedLockfilePath)
      : await readBuildInputsLock(resolvedLockfilePath);

  if (mode === "check")
    return createResult(
      await verifyLocalBuildInputsAgainstLock(selectedInputs, existingLock),
      resolvedLockfilePath,
      false,
      mode,
    );

  const selectedFileInputs = selectedInputs.filter(isFileBuildInput);
  const selectedArchiveInputs = selectedInputs.filter(isArchiveBuildInput);
  const downloadedInputs = await Promise.all(
    selectedFileInputs.map((input) => downloadBuildInput(input)),
  );
  const downloadedArchives = await Promise.all(
    selectedArchiveInputs.map(downloadArchiveBuildInput),
  );
  const preparedArchives: PreparedArchiveBuildInput[] = [];

  try {
    for (const downloadedArchive of downloadedArchives)
      preparedArchives.push(await prepareArchiveBuildInput(downloadedArchive));

    if (mode === "materialize") {
      const results = orderResultsByInputs(selectedInputs, [
        ...verifyDownloadedBuildInputsAgainstLock(downloadedInputs, existingLock),
        ...verifyMaterializedArchivesAgainstLock(preparedArchives, existingLock),
      ]);

      await materializePreparedBuildInputs(downloadedInputs, preparedArchives);

      return createResult(results, resolvedLockfilePath, false, mode);
    }

    const renderedLockContent = renderBuildInputsLock(
      inputs,
      existingLock,
      downloadedInputs,
      preparedArchives,
    );
    const lockContent = buildInputsLockSchema.parse(parseJson(renderedLockContent));

    await materializePreparedBuildInputs(downloadedInputs, preparedArchives);
    await writeFileAtomic(resolvedLockfilePath, renderedLockContent);

    return createResult(
      orderResultsByInputs(selectedInputs, [
        ...downloadedInputs.map((downloaded) =>
          toFileBuildInputResult(downloaded.input, {
            sha256: downloaded.sha256,
            sizeBytes: downloaded.sizeBytes,
          }),
        ),
        ...preparedArchives.map((archive) =>
          toArchiveBuildInputResult(archive.input, getArchiveLockEntry(archive.input, lockContent)),
        ),
      ]),
      resolvedLockfilePath,
      true,
      mode,
    );
  } finally {
    await Promise.all(
      preparedArchives.map((archive) =>
        rm(archive.temporaryRoot, { force: true, recursive: true }),
      ),
    );
  }
};
