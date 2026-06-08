import { mkdir, readFile, writeFile } from "node:fs/promises";

export type CliTextFileSystem = Readonly<{
  makeDirectory: (
    directoryPath: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<void>;
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, text: string) => Promise<void>;
}>;

export const nodeTextFileSystem: CliTextFileSystem = {
  makeDirectory: async (directoryPath, options) => {
    await mkdir(directoryPath, options);
  },
  readTextFile: async (filePath) => {
    const text = await readFile(filePath, "utf8");

    return text;
  },
  writeTextFile: async (filePath, text) => {
    await writeFile(filePath, text, "utf8");
  },
};
