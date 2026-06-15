import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import type {
  DirectoryMerkleDirectoryNode,
  DirectoryMerkleFileNode,
  DirectoryMerkleNode,
} from "./directory-merkle-tree";
import { createDirectoryMerkleTree } from "./directory-merkle-tree";

const makeTempDir = async (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "directory-merkle-tree-"));

const writeFixtureTree = async (rootDir: string, reverseOrder: boolean): Promise<void> => {
  if (reverseOrder) {
    await writeFile(path.join(rootDir, "a.txt"), "alpha\n");
    await mkdir(path.join(rootDir, "src", "nested"), { recursive: true });
    await mkdir(path.join(rootDir, "empty"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "nested", "b.txt"), "bravo\n");
    await writeFile(path.join(rootDir, "src", "run.sh"), "#!/bin/sh\n");
    await chmod(path.join(rootDir, "src", "run.sh"), 0o755);
    return;
  }

  await mkdir(path.join(rootDir, "empty"), { recursive: true });
  await mkdir(path.join(rootDir, "src", "nested"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "run.sh"), "#!/bin/sh\n");
  await chmod(path.join(rootDir, "src", "run.sh"), 0o755);
  await writeFile(path.join(rootDir, "src", "nested", "b.txt"), "bravo\n");
  await writeFile(path.join(rootDir, "a.txt"), "alpha\n");
};

const findChild = (directory: DirectoryMerkleDirectoryNode, name: string): DirectoryMerkleNode => {
  const child = directory.children.find((candidate) => candidate.name === name);

  if (child === undefined) throw new Error(`Missing child ${name}`);

  return child;
};

const findDirectory = (
  directory: DirectoryMerkleDirectoryNode,
  name: string,
): DirectoryMerkleDirectoryNode => {
  const child = findChild(directory, name);

  if (child.kind !== "directory") throw new Error(`Expected ${name} to be a directory`);

  return child;
};

const findFile = (
  directory: DirectoryMerkleDirectoryNode,
  name: string,
): DirectoryMerkleFileNode => {
  const child = findChild(directory, name);

  if (child.kind !== "file") throw new Error(`Expected ${name} to be a file`);

  return child;
};

void describe("createDirectoryMerkleTree", () => {
  void test("builds a deterministic full tree with concurrent file hashing", async () => {
    const firstRoot = await makeTempDir();
    const secondRoot = await makeTempDir();

    try {
      await writeFixtureTree(firstRoot, false);
      await writeFixtureTree(secondRoot, true);

      const firstTree = await createDirectoryMerkleTree(firstRoot, { concurrency: 1 });
      const secondTree = await createDirectoryMerkleTree(secondRoot, { concurrency: 4 });
      const src = findDirectory(firstTree.root, "src");
      const nested = findDirectory(src, "nested");
      const executable = findFile(src, "run.sh");

      assert.equal(firstTree.sha256, secondTree.sha256);
      assert.equal(firstTree.fileCount, 3);
      assert.equal(firstTree.directoryCount, 4);
      assert.equal(firstTree.totalSizeBytes, 22);
      assert.deepEqual(
        firstTree.root.children.map((child) => child.name),
        ["empty", "src", "a.txt"],
      );
      assert.deepEqual(
        src.children.map((child) => child.name),
        ["nested", "run.sh"],
      );
      assert.equal(findFile(nested, "b.txt").relativePath, "src/nested/b.txt");
      assert.equal(executable.mode, "755");
    } finally {
      await rm(firstRoot, { force: true, recursive: true });
      await rm(secondRoot, { force: true, recursive: true });
    }
  });

  void test("includes empty directories in the root digest", async () => {
    const withEmptyDirectory = await makeTempDir();
    const withoutEmptyDirectory = await makeTempDir();

    try {
      await writeFile(path.join(withEmptyDirectory, "a.txt"), "alpha\n");
      await mkdir(path.join(withEmptyDirectory, "empty"));
      await writeFile(path.join(withoutEmptyDirectory, "a.txt"), "alpha\n");

      const treeWithEmptyDirectory = await createDirectoryMerkleTree(withEmptyDirectory);
      const treeWithoutEmptyDirectory = await createDirectoryMerkleTree(withoutEmptyDirectory);

      assert.notEqual(treeWithEmptyDirectory.sha256, treeWithoutEmptyDirectory.sha256);
      assert.equal(treeWithEmptyDirectory.directoryCount, 2);
      assert.equal(treeWithoutEmptyDirectory.directoryCount, 1);
    } finally {
      await rm(withEmptyDirectory, { force: true, recursive: true });
      await rm(withoutEmptyDirectory, { force: true, recursive: true });
    }
  });

  void test("includes the normalized executable bit in file node digests", async () => {
    const executableRoot = await makeTempDir();
    const plainRoot = await makeTempDir();

    try {
      await writeFile(path.join(executableRoot, "tool"), "run\n");
      await chmod(path.join(executableRoot, "tool"), 0o755);
      await writeFile(path.join(plainRoot, "tool"), "run\n");
      await chmod(path.join(plainRoot, "tool"), 0o644);

      const executableTree = await createDirectoryMerkleTree(executableRoot);
      const plainTree = await createDirectoryMerkleTree(plainRoot);

      assert.notEqual(executableTree.sha256, plainTree.sha256);
      assert.equal(findFile(executableTree.root, "tool").mode, "755");
      assert.equal(findFile(plainTree.root, "tool").mode, "644");
    } finally {
      await rm(executableRoot, { force: true, recursive: true });
      await rm(plainRoot, { force: true, recursive: true });
    }
  });

  void test("rejects symlinks", async () => {
    const rootDir = await makeTempDir();

    try {
      await writeFile(path.join(rootDir, "target.txt"), "target\n");
      await symlink("target.txt", path.join(rootDir, "link.txt"));

      await assert.rejects(createDirectoryMerkleTree(rootDir), (error: unknown): boolean =>
        String(error).includes("does not support symlinks"),
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  void test("rejects invalid concurrency", async () => {
    const rootDir = await makeTempDir();

    try {
      await assert.rejects(
        createDirectoryMerkleTree(rootDir, { concurrency: 0 }),
        (error: unknown): boolean => String(error).includes("positive integer"),
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
