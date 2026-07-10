import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { getTokenAtPosition, isStringLiteral } from "@typescript/native-preview/unstable/ast";
import type { SourceFile } from "@typescript/native-preview/unstable/ast";
import { createVirtualFileSystem } from "@typescript/native-preview/unstable/fs";
import type { FileSystem } from "@typescript/native-preview/unstable/fs";
import { API, TypeFlags } from "@typescript/native-preview/unstable/sync";
import type {
  Project,
  Snapshot,
  Type,
  UnionOrIntersectionType,
} from "@typescript/native-preview/unstable/sync";

import type { RuleContext } from "#rule";

const digestLength = 40;

interface WritableFileSystem extends FileSystem {
  readFile: NonNullable<FileSystem["readFile"]>;
  writeFile: NonNullable<FileSystem["writeFile"]>;
}

export interface SourceContext {
  project: Project;
  sourceFile: SourceFile;
}

type SyntheticCompilerOptions = Readonly<{
  allowJs: true;
  jsx: "react-jsx";
  module: "ESNext";
  moduleResolution: "Bundler";
  noLib: true;
  strict: true;
  target: "ESNext";
}>;
type SyntheticTsconfig = Readonly<{
  compilerOptions: SyntheticCompilerOptions;
  files: readonly [string];
}>;

const normalizePath = (filePath: string): string => path.resolve(filePath);

const isSameOrDescendantPath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);

  return (
    relativePath.length === 0 || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

const createOverlayFileSystem = (): WritableFileSystem => {
  const virtualFileSystem = createVirtualFileSystem({});
  const isVirtualDirectory = (directoryName: string): boolean =>
    virtualFileSystem.directoryExists?.(normalizePath(directoryName)) === true;

  return {
    directoryExists: (directoryName) => (isVirtualDirectory(directoryName) ? true : undefined),
    fileExists: (fileName) =>
      virtualFileSystem.fileExists?.(normalizePath(fileName)) === true ? true : undefined,
    getAccessibleEntries: (directoryName) => {
      const normalizedDirectory = normalizePath(directoryName);

      return isVirtualDirectory(normalizedDirectory)
        ? virtualFileSystem.getAccessibleEntries?.(normalizedDirectory)
        : undefined;
    },
    readFile: (fileName) => virtualFileSystem.readFile?.(normalizePath(fileName)),
    writeFile: (fileName, content) => {
      virtualFileSystem.writeFile?.(normalizePath(fileName), content);
    },
  };
};

const getSyntheticConfigText = (absolutePath: string): string =>
  JSON.stringify({
    compilerOptions: {
      allowJs: true,
      jsx: "react-jsx",
      module: "ESNext",
      moduleResolution: "Bundler",
      noLib: true,
      strict: true,
      target: "ESNext",
    },
    files: [absolutePath],
  } satisfies SyntheticTsconfig);

const getSyntheticConfigPath = (rootDir: string, absolutePath: string): string => {
  const digest = createHash("sha1").update(absolutePath).digest("hex").slice(0, digestLength);

  return path.join(rootDir, ".x2zod-code-quality", `${digest}.tsconfig.json`);
};

const isStringType = (type: Type): boolean => type.flags === TypeFlags.String;

const isUnionType = (type: Type): type is UnionOrIntersectionType => type.flags === TypeFlags.Union;

const isWidenedStringType = (type: Type | undefined): boolean => {
  if (type === undefined) return false;
  if (isStringType(type)) return true;
  if (!isUnionType(type)) return false;

  return type.getTypes().some((candidate) => isWidenedStringType(candidate));
};

class NativeTypeScriptService {
  private readonly api: API;
  private readonly openedConfigPaths = new Set<string>();
  private readonly overlayFileSystem = createOverlayFileSystem();
  private readonly rootDir: string;
  private readonly sourceContexts = new Map<string, SourceContext | undefined>();
  private readonly tsconfigPathsByDirectory = new Map<string, string | null>();
  private snapshot: Snapshot | undefined;

  public constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.api = new API({ cwd: rootDir, fs: this.overlayFileSystem });
  }

  public close(): void {
    this.snapshot?.dispose();
    this.snapshot = undefined;
    this.openedConfigPaths.clear();
    this.api.close();
  }

  public getSourceContext(context: RuleContext): SourceContext | undefined {
    const absolutePath = normalizePath(context.filename);
    const cacheKey = `${absolutePath}\0${context.sourceCode.text}`;

    if (this.sourceContexts.has(cacheKey)) return this.sourceContexts.get(cacheKey);

    const sourceContext = this.createSourceContext(absolutePath, context.sourceCode.text);

    this.sourceContexts.set(cacheKey, sourceContext);

    return sourceContext;
  }

  public isWidenedStringContext(context: RuleContext, position: number): boolean {
    const sourceContext = this.getSourceContext(context);

    if (sourceContext === undefined || sourceContext.sourceFile.text !== context.sourceCode.text)
      return false;

    const token = getTokenAtPosition(sourceContext.sourceFile, position);

    if (!isStringLiteral(token)) return false;

    return isWidenedStringType(sourceContext.project.checker.getContextualType(token));
  }

  private createSourceContext(absolutePath: string, sourceText: string): SourceContext | undefined {
    const preferredConfigPath = this.getTsconfigPath(absolutePath);
    const sourceChanged = this.overlayFileSystem.readFile(absolutePath) !== sourceText;

    this.overlayFileSystem.writeFile(absolutePath, sourceText);

    return (
      this.getSourceContextForConfig(preferredConfigPath, absolutePath, sourceChanged) ??
      this.getSourceContextForConfig(
        this.getSyntheticTsconfigPath(absolutePath),
        absolutePath,
        true,
      )
    );
  }

  private getSourceContextForConfig(
    configPath: string,
    absolutePath: string,
    sourceChanged: boolean,
  ): SourceContext | undefined {
    this.updateSnapshotForFile(configPath, absolutePath, sourceChanged);

    const project =
      this.getDefaultProjectForFile(absolutePath) ?? this.snapshot?.getProject(configPath);
    const sourceFile = project?.program.getSourceFile(absolutePath);

    return project !== undefined && sourceFile !== undefined ? { project, sourceFile } : undefined;
  }

  private getDefaultProjectForFile(absolutePath: string): Project | undefined {
    try {
      return this.snapshot?.getDefaultProjectForFile(absolutePath);
    } catch {
      return undefined;
    }
  }

  private getSyntheticTsconfigPath(absolutePath: string): string {
    const syntheticConfigPath = getSyntheticConfigPath(this.rootDir, absolutePath);

    this.overlayFileSystem.writeFile(syntheticConfigPath, getSyntheticConfigText(absolutePath));

    return syntheticConfigPath;
  }

  private updateSnapshotForFile(
    configPath: string,
    absolutePath: string,
    sourceChanged: boolean,
  ): void {
    const shouldOpenProject = !this.openedConfigPaths.has(configPath);

    if (!shouldOpenProject && !sourceChanged) return;

    const previousSnapshot = this.snapshot;

    this.snapshot = shouldOpenProject
      ? this.api.updateSnapshot({ openProject: configPath })
      : this.api.updateSnapshot({ fileChanges: { changed: [absolutePath] } });
    this.sourceContexts.clear();

    if (shouldOpenProject) this.openedConfigPaths.add(configPath);

    previousSnapshot?.dispose();
  }

  private getTsconfigPath(absolutePath: string): string {
    return (
      this.findNearestTsconfigPath(absolutePath) ?? this.getSyntheticTsconfigPath(absolutePath)
    );
  }

  private findNearestTsconfigPath(absolutePath: string): string | undefined {
    const startDirectory = path.dirname(absolutePath);
    let directory = startDirectory;

    while (isSameOrDescendantPath(this.rootDir, directory)) {
      const cachedPath = this.tsconfigPathsByDirectory.get(directory);

      if (cachedPath !== undefined) return cachedPath ?? undefined;

      const tsconfigPath = path.join(directory, "tsconfig.json");

      if (existsSync(tsconfigPath)) {
        this.tsconfigPathsByDirectory.set(startDirectory, tsconfigPath);
        this.tsconfigPathsByDirectory.set(directory, tsconfigPath);

        return tsconfigPath;
      }

      if (directory === this.rootDir) break;

      directory = path.dirname(directory);
    }

    this.tsconfigPathsByDirectory.set(startDirectory, null);

    return undefined;
  }
}

const nativeServicesByRoot = new Map<string, NativeTypeScriptService>();

export const getNativeService = (context: RuleContext): NativeTypeScriptService => {
  const rootDir = normalizePath(context.cwd);
  const cachedService = nativeServicesByRoot.get(rootDir);

  if (cachedService !== undefined) return cachedService;

  const service = new NativeTypeScriptService(rootDir);

  nativeServicesByRoot.set(rootDir, service);

  return service;
};

export const closeNativeServicesForTests = (): void => {
  for (const service of nativeServicesByRoot.values()) service.close();

  nativeServicesByRoot.clear();
};
