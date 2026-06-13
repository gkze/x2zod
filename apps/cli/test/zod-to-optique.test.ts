import { expect, test } from "bun:test";

import { runParserSync } from "@optique/core";
import { z } from "zod/v4";

import { ZodCliOptionSchemaError, withCli, zodObjectToOptique } from "../src/zod-to-optique";

const DEFAULT_COUNT = 3;
const MIN_NAME_LENGTH = 3;

const ignoreOutput = (_output: string): undefined => undefined;

const run = <TSchema extends z.ZodType>(
  schema: TSchema,
  args: readonly string[],
): z.output<TSchema> =>
  runParserSync(zodObjectToOptique(schema), "x2zod-test", args, {
    aboveError: "none",
    showChoices: true,
    showDefault: true,
    stderr: ignoreOutput,
    stdout: ignoreOutput,
  });

test("zodObjectToOptique parses scalar options, derived long names, and Zod defaults", () => {
  const schema = z
    .strictObject({
      count: withCli(z.int().default(DEFAULT_COUNT), { short: "-c" }),
      dialect: withCli(z.enum(["draft-07", "draft-2020-12"]).default("draft-2020-12"), {
        long: "--schema-dialect",
        short: "-d",
      }),
      enabled: withCli(z.boolean().default(false), { short: "-e" }),
      inputPath: withCli(z.string(), {
        description: "Schema document path.",
        short: "-i",
        valueName: "FILE",
      }),
      ratio: withCli(z.number().optional(), { short: "-r" }),
    })
    .readonly();

  expect(run(schema, ["-i", "schema.json"])).toEqual({
    count: 3,
    dialect: "draft-2020-12",
    enabled: false,
    inputPath: "schema.json",
  });

  expect(
    run(schema, [
      "--input-path",
      "schema.json",
      "--count",
      "5",
      "--schema-dialect",
      "draft-07",
      "--enabled",
      "true",
      "--ratio",
      "1.5",
    ]),
  ).toEqual({ count: 5, dialect: "draft-07", enabled: true, inputPath: "schema.json", ratio: 1.5 });
});

test("zodObjectToOptique parses boolean options as explicit values", () => {
  const schema = z.strictObject({ enabled: withCli(z.boolean().default(true), { short: "-e" }) });

  expect(run(schema, ["--enabled", "false"])).toEqual({ enabled: false });
  expect(run(schema, ["-e", "true"])).toEqual({ enabled: true });
});

test("zodObjectToOptique preserves absent optional arrays", () => {
  const schema = z.strictObject({
    include: withCli(z.array(z.string()).default(["base.json"]), {
      long: "--include",
      short: "-I",
      valueName: "FILE",
    }),
    tags: withCli(z.array(z.enum(["core", "cli"])).optional(), { short: "-t" }),
  });

  expect(run(schema, [])).toEqual({ include: ["base.json"] });
  expect(run(schema, ["--tags", "core"])).toEqual({ include: ["base.json"], tags: ["core"] });
  expect(
    run(schema, ["--include", "a.json", "-I", "b.json", "-t", "core", "--tags", "cli"]),
  ).toEqual({ include: ["a.json", "b.json"], tags: ["core", "cli"] });
});

test("zodObjectToOptique requires at least one value for required array options", () => {
  const schema = z.strictObject({ refs: withCli(z.array(z.string()), { short: "-r" }) });

  expect(() => run(schema, [])).toThrow();
  expect(run(schema, ["--refs", "schema.json"])).toEqual({ refs: ["schema.json"] });
});

test("zodObjectToOptique finds metadata through supported wrappers", () => {
  const schema = z.strictObject({
    count: withCli(z.int(), { short: "-c" }).optional(),
    mode: withCli(z.enum(["fast", "strict"]), { short: "-m" }).default("fast"),
  });

  expect(run(schema, [])).toEqual({ mode: "fast" });
  expect(run(schema, ["--mode", "strict", "--count", "7"])).toEqual({ count: 7, mode: "strict" });
});

test("zodObjectToOptique runs final Zod validation after CLI value parsing", () => {
  const schema = z.strictObject({
    name: withCli(z.string().min(MIN_NAME_LENGTH), { short: "-n" }),
  });

  expect(() => run(schema, ["--name", "ab"])).toThrow();
  expect(run(schema, ["--name", "abcd"])).toEqual({ name: "abcd" });
});

test("zodObjectToOptique rejects schemas without required CLI metadata", () => {
  const schema = z.strictObject({ input: z.string() });

  expect(() => zodObjectToOptique(schema)).toThrow(ZodCliOptionSchemaError);
  expect(() => zodObjectToOptique(schema)).toThrow("input: missing CLI option metadata");
});

test("zodObjectToOptique rejects duplicate short or derived long option names", () => {
  const duplicateShort = z.strictObject({
    first: withCli(z.string(), { short: "-x" }),
    second: withCli(z.string(), { short: "-x" }),
  });
  const duplicateDerivedLong = z.strictObject({
    sourceProfile: withCli(z.string(), { short: "-s" }),
    "source-profile": withCli(z.string(), { short: "-p" }),
  });

  expect(() => zodObjectToOptique(duplicateShort)).toThrow(
    "second: option name -x is already used by first",
  );
  expect(() => zodObjectToOptique(duplicateDerivedLong)).toThrow(
    "source-profile: option name --source-profile is already used by sourceProfile",
  );
});

test("zodObjectToOptique rejects invalid option metadata", () => {
  expect(() =>
    zodObjectToOptique(z.strictObject({ input: withCli(z.string(), { short: "--input" }) })),
  ).toThrow("input: invalid short option name --input");

  expect(() =>
    zodObjectToOptique(
      z.strictObject({ input: withCli(z.string(), { long: "--1input", short: "-i" }) }),
    ),
  ).toThrow("input: invalid long option name --1input");

  expect(() =>
    zodObjectToOptique(
      z.strictObject({ help: withCli(z.string(), { long: "--help", short: "-h" }) }),
    ),
  ).toThrow("help: reserved help option name -h");
});

test("zodObjectToOptique rejects unsupported root and field schema shapes", () => {
  expect(() => zodObjectToOptique(withCli(z.string(), { short: "-s" }))).toThrow(
    "<root>: expected a root Zod object schema",
  );

  expect(() =>
    zodObjectToOptique(
      z.strictObject({ nested: withCli(z.strictObject({ value: z.string() }), { short: "-n" }) }),
    ),
  ).toThrow("nested: unsupported CLI option schema type object");

  expect(() =>
    zodObjectToOptique(z.object({ input: withCli(z.string(), { short: "-i" }) }).loose()),
  ).toThrow("<root>: object catchalls and passthrough keys are not supported");

  expect(() =>
    zodObjectToOptique(
      z.strictObject({ records: withCli(z.record(z.string(), z.string()), { short: "-r" }) }),
    ),
  ).toThrow("records: unsupported CLI option schema type record");

  expect(() =>
    zodObjectToOptique(
      z.strictObject({
        objects: withCli(z.array(z.strictObject({ value: z.string() })), { short: "-o" }),
      }),
    ),
  ).toThrow("objects.<element>: unsupported CLI option schema type object");
});
