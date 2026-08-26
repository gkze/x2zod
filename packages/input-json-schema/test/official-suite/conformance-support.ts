import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";

import AjvDraft7 from "ajv";
import type { Options, ValidateFunction } from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";

import { jsonSchemaValueSchema } from "../../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../../src";

const officialSuiteRemoteBaseUri = "http://localhost:1234/";
const ajvOptions = {
  allErrors: true,
  logger: false,
  ownProperties: true,
  strict: false,
  validateSchema: false,
} satisfies Options;

export type OfficialSuiteExternalSchemas = Readonly<Record<string, JsonSchemaValue>>;

const sortBefore = -1;
const sortEqual = 0;
const sortAfter = 1;

const compareText = (left: string, right: string): number => {
  if (left === right) return sortEqual;
  return left < right ? sortBefore : sortAfter;
};

const listJsonFiles = async (directory: string): Promise<readonly string[]> => {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const entries = directoryEntries.toSorted((left, right) => compareText(left.name, right.name));
  const nestedFiles = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const entryPath = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        const files = await listJsonFiles(entryPath);
        return files;
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    }),
  );
  return nestedFiles.flat();
};

const officialSuiteRemoteUri = (suiteRemotesDirectory: string, file: string): string =>
  new URL(
    nodePath.relative(suiteRemotesDirectory, file).split(nodePath.sep).join("/"),
    officialSuiteRemoteBaseUri,
  ).href;

export const loadOfficialSuiteExternalSchemas = async (
  suiteRemotesDirectory: string,
): Promise<OfficialSuiteExternalSchemas> => {
  const files = await listJsonFiles(suiteRemotesDirectory);
  const entries = await Promise.all(
    files.map(
      async (file) =>
        [
          officialSuiteRemoteUri(suiteRemotesDirectory, file),
          jsonSchemaValueSchema.parse(JSON.parse(await readFile(file, "utf8"))),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
};

export const createOfficialSuiteValidator = (
  dialect: JsonSchemaDialect,
  schema: JsonSchemaValue,
  externalSchemas: OfficialSuiteExternalSchemas,
): ValidateFunction => {
  const options = { ...ajvOptions, schemas: externalSchemas } satisfies Options;
  if (dialect === "draft-7") return new AjvDraft7(options).compile(schema);
  if (dialect === "draft-2019-09") return new AjvDraft2019(options).compile(schema);
  return new AjvDraft2020(options).compile(schema);
};
