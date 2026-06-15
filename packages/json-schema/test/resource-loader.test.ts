import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { createFileSystemResourceLoader } from "../src";
import type { FilePathResolver, TextFileSystem } from "../src";

const createMemoryTextFileSystem = (
  files: Readonly<Record<string, string>>,
  rootDirectory: string,
): TextFileSystem => ({
  readTextFile: async (filePath): Promise<string> => {
    await Promise.resolve();
    const text = files[path.relative(rootDirectory, filePath)];
    if (text === undefined) throw new Error(`Missing memory file: ${filePath}`);
    return text;
  },
});

const nodePathResolver: FilePathResolver = {
  resolveFilePath: ({ path: filePath, rootDirectory }) => path.resolve(rootDirectory, filePath),
};

void describe("createFileSystemResourceLoader", () => {
  void test("loads a JSON Schema document through a pluggable text filesystem", async () => {
    const rootDirectory = "/workspace";
    const fileSystem = createMemoryTextFileSystem(
      { "schemas/user.schema.json": '{ "type": "object" }\n' },
      rootDirectory,
    );
    const loader = createFileSystemResourceLoader({
      fileSystem,
      pathResolver: nodePathResolver,
      rootDirectory,
      mediaType: "application/schema+json",
    });

    const document = await loader.loadTextResource({
      source: { kind: "file", path: "schemas/user.schema.json" },
    });

    assert.deepEqual(document, {
      source: { kind: "file", path: "/workspace/schemas/user.schema.json" },
      text: '{ "type": "object" }\n',
      mediaType: "application/schema+json",
    });
  });

  void test("lets callers override the default media type per resource", async () => {
    const rootDirectory = "/workspace";
    const fileSystem = createMemoryTextFileSystem(
      { "schemas/user.schema.json": '{ "type": "object" }\n' },
      rootDirectory,
    );
    const loader = createFileSystemResourceLoader({
      fileSystem,
      pathResolver: nodePathResolver,
      rootDirectory,
      mediaType: "application/schema+json",
    });

    const document = await loader.loadTextResource({
      source: { kind: "file", path: "schemas/user.schema.json" },
      mediaType: "application/json",
    });

    assert.equal(document.mediaType, "application/json");
  });
});
