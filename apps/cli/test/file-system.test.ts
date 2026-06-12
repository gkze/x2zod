import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bunTextFileSystem } from "../src/file-system";

test("bunTextFileSystem writes and reads UTF-8 text", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "x2zod-cli-"));

  try {
    const outputDirectory = path.join(tempDirectory, "generated");
    const outputPath = path.join(outputDirectory, "schema.ts");
    const outputText = "export const value = 1;\n";

    await bunTextFileSystem.makeDirectory(outputDirectory, { recursive: true });
    await bunTextFileSystem.writeTextFile(outputPath, outputText);

    expect(await bunTextFileSystem.readTextFile(outputPath)).toBe(outputText);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
});
