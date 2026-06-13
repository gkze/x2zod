import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";

import pLimit from "p-limit";

export type DirectoryMerkleNodeKind = "directory" | "file";
export type DirectoryMerkleFileMode = "644" | "755";

export type DirectoryMerkleNode = DirectoryMerkleDirectoryNode | DirectoryMerkleFileNode;

export interface DirectoryMerkleTreeOptions {
  concurrency?: number;
}

export interface DirectoryMerkleTree {
  directoryCount: number;
  fileCount: number;
  root: DirectoryMerkleDirectoryNode;
  sha256: string;
  totalSizeBytes: number;
}

export interface DirectoryMerkleDirectoryNode {
  children: readonly DirectoryMerkleNode[];
  kind: "directory";
  name: string;
  relativePath: string;
  sha256: string;
}

export interface DirectoryMerkleFileNode {
  contentSha256: string;
  kind: "file";
  mode: DirectoryMerkleFileMode;
  name: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

interface CollectedDirectory {
  absolutePath: string;
  childDirectoryIds: number[];
  childFileIds: number[];
  depth: number;
  id: number;
  name: string;
  relativePath: string;
}

interface CollectedFile {
  absolutePath: string;
  id: number;
  mode: DirectoryMerkleFileMode;
  name: string;
  relativePath: string;
  sizeBytes: number;
}

interface CollectedTree {
  directories: CollectedDirectory[];
  files: CollectedFile[];
}

interface ChildDigest {
  kind: DirectoryMerkleNodeKind;
  name: string;
  sha256: string;
}

interface FileContentHash {
  sha256: string;
  sizeBytes: number;
}

interface HashedDirectory {
  id: number;
  name: string;
  relativePath: string;
  sha256: string;
}

interface HashedFile {
  contentSha256: string;
  id: number;
  mode: DirectoryMerkleFileMode;
  name: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

const maxConcurrency = 64;
const defaultConcurrencyLimit = 8;

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareChildDigests = (left: ChildDigest, right: ChildDigest): number => {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;

  return compareCodeUnits(left.name, right.name);
};

const compareMerkleNodes = (left: DirectoryMerkleNode, right: DirectoryMerkleNode): number =>
  compareChildDigests(
    { kind: left.kind, name: left.name, sha256: left.sha256 },
    { kind: right.kind, name: right.name, sha256: right.sha256 },
  );

const compareDirectoriesByDescendingDepth = (
  left: CollectedDirectory,
  right: CollectedDirectory,
): number => {
  if (left.depth !== right.depth) return right.depth - left.depth;
  return compareCodeUnits(left.relativePath, right.relativePath);
};

const normalizeConcurrency = (concurrency: number | undefined): number => {
  if (concurrency === undefined) return Math.min(defaultConcurrencyLimit, availableParallelism());

  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("Directory Merkle tree concurrency must be a positive integer");

  if (concurrency > maxConcurrency)
    throw new Error(
      `Directory Merkle tree concurrency must be less than or equal to ${maxConcurrency}`,
    );

  return concurrency;
};

const validateEntryName = (name: string, parentPath: string): void => {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    const location = parentPath.length === 0 ? "." : parentPath;
    throw new Error(`Unsafe directory entry name '${name}' under ${location}`);
  }
};

const joinRelativePath = (parentPath: string, name: string): string =>
  parentPath.length === 0 ? name : `${parentPath}/${name}`;

const readDirectoryEntries = async (directoryPath: string): Promise<readonly Dirent[]> => {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  entries.sort((left, right) => compareCodeUnits(left.name, right.name));

  return entries;
};

const fileModeFromModeBits = (mode: number): DirectoryMerkleFileMode =>
  (mode & 0o111) === 0 ? "644" : "755";

const collectTree = async (rootDir: string): Promise<CollectedTree> => {
  const absoluteRootDir = path.resolve(rootDir);
  const rootStats = await lstat(absoluteRootDir);

  if (!rootStats.isDirectory())
    throw new Error(`Directory Merkle tree root is not a directory: ${rootDir}`);

  const root: CollectedDirectory = {
    absolutePath: absoluteRootDir,
    childDirectoryIds: [],
    childFileIds: [],
    depth: 0,
    id: 0,
    name: "",
    relativePath: "",
  };
  const directories: CollectedDirectory[] = [root];
  const files: CollectedFile[] = [];
  const directoryStack: CollectedDirectory[] = [root];

  while (directoryStack.length > 0) {
    const directory = directoryStack.pop();

    if (directory === undefined) throw new Error("Directory traversal stack underflow");

    for (const entry of await readDirectoryEntries(directory.absolutePath)) {
      const { name } = entry;

      validateEntryName(name, directory.relativePath);

      const absolutePath = path.join(directory.absolutePath, name);
      const relativePath = joinRelativePath(directory.relativePath, name);

      if (entry.isSymbolicLink())
        throw new Error(`Directory Merkle tree does not support symlinks: ${relativePath}`);

      if (entry.isDirectory()) {
        const childDirectory: CollectedDirectory = {
          absolutePath,
          childDirectoryIds: [],
          childFileIds: [],
          depth: directory.depth + 1,
          id: directories.length,
          name,
          relativePath,
        };

        directory.childDirectoryIds.push(childDirectory.id);
        directories.push(childDirectory);
        directoryStack.push(childDirectory);
        continue;
      }

      if (entry.isFile()) {
        const stats = await lstat(absolutePath);

        if (stats.isSymbolicLink())
          throw new Error(`Directory Merkle tree does not support symlinks: ${relativePath}`);

        if (!stats.isFile())
          throw new Error(
            `Directory Merkle tree only supports regular files and directories: ${relativePath}`,
          );

        const file: CollectedFile = {
          absolutePath,
          id: files.length,
          mode: fileModeFromModeBits(stats.mode),
          name,
          relativePath,
          sizeBytes: stats.size,
        };

        directory.childFileIds.push(file.id);
        files.push(file);
        continue;
      }

      throw new Error(
        `Directory Merkle tree only supports regular files and directories: ${relativePath}`,
      );
    }
  }

  return { directories, files };
};

const hashFileContent = async (absolutePath: string): Promise<FileContentHash> => {
  const hash = createHash("sha256");
  let sizeBytes = 0;

  for await (const buffer of createReadStream(absolutePath) as AsyncIterable<Buffer>) {
    sizeBytes += buffer.byteLength;
    hash.update(buffer);
  }

  return { sha256: hash.digest("hex"), sizeBytes };
};

const hashFileNode = (file: CollectedFile, contentSha256: string): string => {
  const hash = createHash("sha256");

  hash.update("build-inputs:file:v1\0", "utf8");
  hash.update(file.mode, "utf8");
  hash.update("\0", "utf8");
  hash.update(String(file.sizeBytes), "utf8");
  hash.update("\0", "utf8");
  hash.update(contentSha256, "utf8");

  return hash.digest("hex");
};

const hashDirectoryNode = (children: readonly ChildDigest[]): string => {
  const hash = createHash("sha256");

  hash.update("build-inputs:directory:v1\0", "utf8");

  for (const child of children) {
    hash.update(child.kind, "utf8");
    hash.update("\0", "utf8");
    hash.update(child.name, "utf8");
    hash.update("\0", "utf8");
    hash.update(child.sha256, "utf8");
    hash.update("\0\n", "utf8");
  }

  return hash.digest("hex");
};

const hashCollectedFile = async (file: CollectedFile): Promise<HashedFile> => {
  const content = await hashFileContent(file.absolutePath);

  if (content.sizeBytes !== file.sizeBytes)
    throw new Error(
      `File changed while hashing ${file.relativePath}: expected ${file.sizeBytes} bytes, read ${content.sizeBytes}`,
    );

  return {
    contentSha256: content.sha256,
    id: file.id,
    mode: file.mode,
    name: file.name,
    relativePath: file.relativePath,
    sha256: hashFileNode(file, content.sha256),
    sizeBytes: file.sizeBytes,
  };
};

const hashFiles = async (
  files: readonly CollectedFile[],
  concurrency: number,
): Promise<readonly HashedFile[]> => {
  const limit = pLimit(concurrency);
  const hashedFiles = await Promise.all(files.map((file) => limit(() => hashCollectedFile(file))));

  hashedFiles.sort((left, right) => left.id - right.id);

  return hashedFiles;
};

const hashDirectories = (
  directories: readonly CollectedDirectory[],
  hashedFiles: readonly HashedFile[],
): ReadonlyMap<number, HashedDirectory> => {
  const hashedDirectories = new Map<number, HashedDirectory>();
  const hashedFilesById = new Map(hashedFiles.map((file) => [file.id, file]));
  const directoriesByDescendingDepth = [...directories];

  directoriesByDescendingDepth.sort(compareDirectoriesByDescendingDepth);

  for (const directory of directoriesByDescendingDepth) {
    const childDigests: ChildDigest[] = [];

    for (const childDirectoryId of directory.childDirectoryIds) {
      const childDirectory = hashedDirectories.get(childDirectoryId);

      if (childDirectory === undefined)
        throw new Error(`Missing child directory ${childDirectoryId}`);

      childDigests.push({
        kind: "directory",
        name: childDirectory.name,
        sha256: childDirectory.sha256,
      });
    }

    for (const childFileId of directory.childFileIds) {
      const childFile = hashedFilesById.get(childFileId);

      if (childFile === undefined) throw new Error(`Missing child file ${childFileId}`);

      childDigests.push({ kind: "file", name: childFile.name, sha256: childFile.sha256 });
    }

    childDigests.sort(compareChildDigests);

    hashedDirectories.set(directory.id, {
      id: directory.id,
      name: directory.name,
      relativePath: directory.relativePath,
      sha256: hashDirectoryNode(childDigests),
    });
  }

  return hashedDirectories;
};

const buildPublicFileNodeById = (
  hashedFiles: readonly HashedFile[],
): ReadonlyMap<number, DirectoryMerkleFileNode> =>
  new Map(
    hashedFiles.map((file) => [
      file.id,
      {
        contentSha256: file.contentSha256,
        kind: "file",
        mode: file.mode,
        name: file.name,
        relativePath: file.relativePath,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
      },
    ]),
  );

const buildPublicDirectoryTree = (
  directories: readonly CollectedDirectory[],
  hashedFiles: readonly HashedFile[],
  hashedDirectories: ReadonlyMap<number, HashedDirectory>,
): DirectoryMerkleDirectoryNode => {
  const fileNodesById = buildPublicFileNodeById(hashedFiles);
  const directoryNodes = new Map<number, DirectoryMerkleDirectoryNode>();
  const directoriesByDescendingDepth = [...directories];

  directoriesByDescendingDepth.sort(compareDirectoriesByDescendingDepth);

  for (const directory of directoriesByDescendingDepth) {
    const children: DirectoryMerkleNode[] = [];

    for (const childDirectoryId of directory.childDirectoryIds) {
      const childDirectory = directoryNodes.get(childDirectoryId);

      if (childDirectory === undefined)
        throw new Error(`Missing public directory node ${childDirectoryId}`);

      children.push(childDirectory);
    }

    for (const childFileId of directory.childFileIds) {
      const childFile = fileNodesById.get(childFileId);

      if (childFile === undefined) throw new Error(`Missing public file node ${childFileId}`);

      children.push(childFile);
    }

    children.sort(compareMerkleNodes);
    const hashedDirectory = hashedDirectories.get(directory.id);

    if (hashedDirectory === undefined) throw new Error(`Missing directory ${directory.id}`);

    directoryNodes.set(directory.id, {
      children,
      kind: "directory",
      name: directory.name,
      relativePath: directory.relativePath,
      sha256: hashedDirectory.sha256,
    });
  }

  const root = directoryNodes.get(0);

  if (root === undefined) throw new Error("Missing public root directory node");

  return root;
};

export const createDirectoryMerkleTree = async (
  rootDir: string,
  options: DirectoryMerkleTreeOptions = {},
): Promise<DirectoryMerkleTree> => {
  const concurrency = normalizeConcurrency(options.concurrency);
  const { directories, files } = await collectTree(rootDir);

  const hashedFiles = await hashFiles(files, concurrency);
  const hashedDirectories = hashDirectories(directories, hashedFiles);

  const root = buildPublicDirectoryTree(directories, hashedFiles, hashedDirectories);
  const totalSizeBytes = hashedFiles.reduce((sum, file) => sum + file.sizeBytes, 0);

  return {
    directoryCount: directories.length,
    fileCount: files.length,
    root,
    sha256: root.sha256,
    totalSizeBytes,
  };
};
