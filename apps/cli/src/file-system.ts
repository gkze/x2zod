import { mkdir } from "node:fs/promises";

export type CliTextFileSystem = Readonly<{
  makeDirectory: (
    directoryPath: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<void>;
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, text: string) => Promise<void>;
}>;

export const bunTextFileSystem: CliTextFileSystem = {
  makeDirectory: async (directoryPath, options) => {
    await mkdir(directoryPath, options);
  },
  readTextFile: async (filePath) => {
    const text = await Bun.file(filePath).text();
    return text;
  },
  writeTextFile: async (filePath, text) => {
    await Bun.write(filePath, text);
  },
};
