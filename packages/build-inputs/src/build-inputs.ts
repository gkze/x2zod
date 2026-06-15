import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MIMEType } from "node:util";

import { match, P } from "ts-pattern";
import type { JsonValue } from "type-fest";

import { downloadArchiveBuildInput, prepareArchiveBuildInput } from "./archive-materialization";
import type { PreparedArchiveBuildInput } from "./archive-materialization";
import { isArchiveBuildInput, isFileBuildInput } from "./guards";
import { sha256Hex } from "./hash";
import {
  getArchiveLockEntry,
  renderBuildInputsLock,
  toArchiveBuildInputResult,
  toFileBuildInputResult,
  verifyDownloadedBuildInputsAgainstLock,
  verifyLocalBuildInputsAgainstLock,
  verifyMaterializedArchivesAgainstLock,
} from "./lockfile";
import { formatWithOxfmt } from "./oxfmt";
import { buildInputPathsOverlap, resolveBuildInputPath } from "./paths";
import {
  buildInputsDeclarationSchema,
  buildInputsLockSchema,
  buildInputsOptionsSchema,
  jsonValueSchema,
} from "./schemas";
import type {
  BuildInputDeclaration,
  BuildInputFormat,
  BuildInputId,
  BuildInputResult,
  BuildInputsDeclaration,
  BuildInputsLock,
  BuildInputsMode,
  BuildInputsOptions,
  BuildInputsResult,
  DownloadedBuildInput,
  ResolvedBuildInput,
  ResolvedBuildInputFile,
} from "./schemas";

export * from "./schemas";

const defaultConfigPath = "build-inputs.json";
const defaultLockfilePath = "build-inputs.lock.json";

const emptyBuildInputsLock = buildInputsLockSchema.parse({ urls: {}, version: 1 });

const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;

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
    ? formatWithOxfmt(formatDownloadedJsonContent(content), getStructuredFormatPath(input, format))
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

const replaceDirectory = async (
  targetDirectory: string,
  sourceDirectory: string,
): Promise<void> => {
  await rm(targetDirectory, { force: true, recursive: true });
  await rename(sourceDirectory, targetDirectory);
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
