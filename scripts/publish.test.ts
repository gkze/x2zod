import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Package } from "@manypkg/get-packages";

import { publishRegistries, publishRegistryPackage } from "./publish";
import type { PublishContext, RegistryPublisher } from "./publish";
import { npmRegistryHasVersion } from "./publish-registries";
import { notFoundStatus } from "./publish-runtime";

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
const jsonResponse = (value: unknown, status?: number): Response =>
  status === undefined ? Response.json(value) : Response.json(value, { status });
const requestUrl = (request: Parameters<typeof fetch>[0]): string => {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  return request.url;
};

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

const createNamedPublisher = (
  name: string,
  publish: RegistryPublisher["publish"],
): RegistryPublisher => ({
  isPackagePublishable: (): boolean => true,
  isVersionPublished: async (): Promise<boolean> => {
    await Promise.resolve();
    return false;
  },
  name,
  publish,
});

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

  void test("continues registry reconciliation after a package publish fails", async () => {
    const publishCalls: string[] = [];
    const failingPublisher = createNamedPublisher("failing-registry", async (): Promise<void> => {
      await Promise.resolve();
      throw new Error("simulated publish failure");
    });
    const succeedingPublisher = createNamedPublisher(
      "succeeding-registry",
      async (publishedPackage): Promise<void> => {
        await Promise.resolve();
        publishCalls.push(publishedPackage.packageJson.name);
      },
    );

    const result = await publishRegistries(
      [failingPublisher, succeedingPublisher],
      [workspacePackage],
      publishContext(false),
    );

    assert.equal(result.published, 1);
    assert.deepEqual(publishCalls, ["@x2zod/example"]);
    assert.deepEqual(result.failures, [
      {
        message: "simulated publish failure",
        packageLabel: "@x2zod/example@1.2.3",
        registry: "failing-registry",
      },
    ]);
  });
});

void describe("npmRegistryHasVersion", () => {
  void test("falls back to npm dist-tags when package metadata is temporarily missing", async () => {
    const requestedUrls: string[] = [];
    const registryFetch = async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      await Promise.resolve();
      const requestedUrl = requestUrl(url);
      requestedUrls.push(requestedUrl);
      if (requestedUrl === "https://registry.npmjs.org/%40x2zod%2Fexample")
        return jsonResponse({ error: "Not found" }, notFoundStatus);
      if (requestedUrl === "https://registry.npmjs.org/-/package/%40x2zod%2Fexample/dist-tags")
        return jsonResponse({ latest: "1.2.3" });

      throw new Error(`Unexpected registry URL: ${requestedUrl}`);
    };

    const published = await npmRegistryHasVersion("@x2zod/example", "1.2.3", registryFetch);

    assert.equal(published, true);
    assert.deepEqual(requestedUrls, [
      "https://registry.npmjs.org/%40x2zod%2Fexample",
      "https://registry.npmjs.org/-/package/%40x2zod%2Fexample/dist-tags",
    ]);
  });
});
