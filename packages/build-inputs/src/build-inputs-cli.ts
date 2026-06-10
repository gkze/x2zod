#!/usr/bin/env bun

import type { NonEmptyString, OptionName } from "@optique/core";
import {
  ensureNonEmptyString,
  flag,
  map,
  multiple,
  object,
  option,
  optional,
  or,
  runParser,
  string,
} from "@optique/core";
import { message, text } from "@optique/core/message";

import type { BuildInputsMode, BuildInputsOptions } from "./build-inputs";
import { buildInputIdSchema, buildInputs } from "./build-inputs";

const programName = "build-inputs";
const nonEmptyString = (value: string): NonEmptyString => {
  ensureNonEmptyString(value);
  return value;
};
const directoryMetavar = nonEmptyString("DIR");
const idMetavar = nonEmptyString("ID");
const pathMetavar = nonEmptyString("PATH");

const modeParser = map(
  optional(
    or(
      map(
        flag("-k", "--check", {
          description: message`Verify local files against the lockfile without downloading sources.`,
        }),
        (): BuildInputsMode => "check",
      ),
      map(
        flag("-u", "--update-lock", {
          description: message`Download sources and update the lockfile with their hashes.`,
        }),
        (): BuildInputsMode => "update-lock",
      ),
    ),
  ),
  (mode): BuildInputsMode => mode ?? "materialize",
);

const optionalStringOption = (
  shortName: OptionName,
  longName: OptionName,
  metavar: NonEmptyString,
  descriptionText: string,
) =>
  optional(
    option(shortName, longName, string({ metavar }), {
      description: message`${text(descriptionText)}`,
    }),
  );

const cliParser = map(
  object({
    configPath: optionalStringOption(
      "-c",
      "--config",
      pathMetavar,
      "Declaration path relative to root. Defaults to build-inputs.json.",
    ),
    ids: multiple(
      map(
        option("-i", "--id", string({ metavar: idMetavar }), {
          description: message`Limit to one build input id. Can be repeated.`,
        }),
        (id) => buildInputIdSchema.parse(id),
      ),
    ),
    lockfilePath: optionalStringOption(
      "-l",
      "--lockfile",
      pathMetavar,
      "Lockfile path relative to root. Defaults to build-inputs.lock.json.",
    ),
    mode: modeParser,
    rootDir: optionalStringOption(
      "-r",
      "--root",
      directoryMetavar,
      "Directory containing build-inputs.json and " + "build-inputs.lock.json. Defaults to cwd.",
    ),
  }),
  (args): BuildInputsOptions => ({
    ids: [...args.ids],
    mode: args.mode,
    ...(args.configPath ? { configPath: args.configPath } : {}),
    ...(args.lockfilePath ? { lockfilePath: args.lockfilePath } : {}),
    ...(args.rootDir ? { rootDir: args.rootDir } : {}),
  }),
);

const buildInputsOptions = runParser(cliParser, programName, process.argv.slice(2), {
  aboveError: "usage",
  brief: message`Materialize declared URL build inputs into filesystem paths with a checked lockfile.`,
  colors: process.stdout.isTTY,
  description: message`By default, ${programName} downloads each declared URL and verifies the content hash against build-inputs.lock.json before writing the target file or unpacked archive directory.`,
  help: {
    option: true,
    onShow: (exitCode = 0): never => {
      process.exit(exitCode);
    },
  },
  maxWidth: process.stdout.columns,
  onError: (exitCode = 1): never => {
    process.exit(exitCode);
  },
  showDefault: true,
});

const result = await buildInputs(buildInputsOptions);

process.stdout.write(`${result.mode} ${result.inputs.length.toString()} build input(s)\n`);
