import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Package } from "@manypkg/get-packages";

import { publishRegistryPackage } from "./publish";
import type { PublishContext, RegistryPublisher } from "./publish";

interface PublisherState {
  publishCalls: number;
  publishDryRuns: boolean[];
  versionChecks: number;
}

const workspacePackage = {
  dir: "/tmp/x2zod-package",
  packageJson: { name: "@x2zod/example", version: "1.2.3" },
} as unknown as Package;

const publishContext = (dryRun: boolean): PublishContext => ({
  dryRun,
  npmAccess: "public",
  packageVersions: new Map([["@x2zod/example", "1.2.3"]]),
});

const createPublisher = (
  versionPublished: boolean,
): Readonly<{ publisher: RegistryPublisher<"test-registry">; state: PublisherState }> => {
  const state: PublisherState = { publishCalls: 0, publishDryRuns: [], versionChecks: 0 };
  const publisher = {
    isPackagePublishable: (): boolean => true,
    isVersionPublished: async (): Promise<boolean> => {
      await Promise.resolve();
      state.versionChecks += 1;
      return versionPublished;
    },
    name: "test-registry",
    publish: async (_workspacePackage: Package, context: PublishContext): Promise<void> => {
      await Promise.resolve();
      state.publishCalls += 1;
      state.publishDryRuns.push(context.dryRun);
    },
  } satisfies RegistryPublisher<"test-registry">;

  return { publisher, state };
};

void describe("publishRegistryPackage", () => {
  void test("skips already-published versions during dry runs", async () => {
    const { publisher, state } = createPublisher(true);

    const result = await publishRegistryPackage(publisher, workspacePackage, publishContext(true));

    assert.equal(result, 0);
    assert.deepEqual(state, { publishCalls: 0, publishDryRuns: [], versionChecks: 1 });
  });

  void test("skips already-published versions during real publishes", async () => {
    const { publisher, state } = createPublisher(true);

    const result = await publishRegistryPackage(publisher, workspacePackage, publishContext(false));

    assert.equal(result, 0);
    assert.deepEqual(state, { publishCalls: 0, publishDryRuns: [], versionChecks: 1 });
  });

  void test("checks absent versions during dry runs", async () => {
    const { publisher, state } = createPublisher(false);

    const result = await publishRegistryPackage(publisher, workspacePackage, publishContext(true));

    assert.equal(result, 1);
    assert.deepEqual(state, { publishCalls: 1, publishDryRuns: [true], versionChecks: 1 });
  });

  void test("publishes absent versions during real publishes", async () => {
    const { publisher, state } = createPublisher(false);

    const result = await publishRegistryPackage(publisher, workspacePackage, publishContext(false));

    assert.equal(result, 1);
    assert.deepEqual(state, { publishCalls: 1, publishDryRuns: [false], versionChecks: 1 });
  });
});
