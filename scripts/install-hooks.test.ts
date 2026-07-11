import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { installRepositoryHooks } from "./install-hooks";

void test("installRepositoryHooks skips source trees without Git metadata", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "x2zod-hooks-"));
  let installCalls = 0;
  try {
    const installed = installRepositoryHooks({
      install: () => {
        installCalls += 1;
      },
      repositoryRoot,
    });

    assert.equal(installed, false);
    assert.equal(installCalls, 0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

void test("installRepositoryHooks installs hooks in a Git worktree", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "x2zod-hooks-"));
  let installCalls = 0;
  try {
    await writeFile(path.join(repositoryRoot, ".git"), "gitdir: /tmp/example\n", "utf8");
    const installed = installRepositoryHooks({
      install: () => {
        installCalls += 1;
      },
      repositoryRoot,
    });

    assert.equal(installed, true);
    assert.equal(installCalls, 1);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
