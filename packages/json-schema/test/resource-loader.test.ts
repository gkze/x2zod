import { describe, expect, test } from "bun:test";
import path from "node:path";

import { Volume } from "memfs";

import { createFileSystemResourceLoader } from "../src";
import type { FilePathResolver, TextFileSystem } from "../src";

const createMemoryTextFileSystem = (
  files: Readonly<Record<string, string>>,
  rootDirectory: string,
): TextFileSystem => {
  const volume = Volume.fromJSON(files, rootDirectory);

  return {
    readTextFile: async (filePath) => String(await volume.promises.readFile(filePath, "utf8")),
  };
};

const nodePathResolver: FilePathResolver = {
  resolveFilePath: ({ path: filePath, rootDirectory }) => path.resolve(rootDirectory, filePath),
};

describe("createFileSystemResourceLoader", () => {
  test("loads a JSON Schema document through a pluggable text filesystem", async () => {
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

    expect(document).toEqual({
      source: { kind: "file", path: "/workspace/schemas/user.schema.json" },
      text: '{ "type": "object" }\n',
      mediaType: "application/schema+json",
    });
  });

  test("lets callers override the default media type per resource", async () => {
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

    expect(document.mediaType).toBe("application/json");
  });
});
