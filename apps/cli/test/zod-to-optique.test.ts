import assert from "node:assert/strict";
import { test } from "node:test";

import { runParserSync } from "@optique/core";
import { z } from "zod/v4";

import {
  ZodCLIOptionSchemaError,
  withCLI,
  zodObjectToOptique,
  zodObjectToOptiqueOverrides,
} from "../src/zod-to-optique";

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

const runOverrides = (
  schema: z.ZodType,
  args: readonly string[],
): Readonly<Record<string, unknown>> =>
  runParserSync(zodObjectToOptiqueOverrides(schema), "x2zod-test", args, {
    aboveError: "none",
    showChoices: true,
    showDefault: true,
    stderr: ignoreOutput,
    stdout: ignoreOutput,
  });

const thrownError = (thrower: () => unknown): unknown => {
  try {
    thrower();
  } catch (error) {
    return error;
  }

  throw new Error("Expected function to throw");
};

const assertThrowsMessage = (thrower: () => unknown, expectedMessage: string): void => {
  const error = thrownError(thrower);
  assert.ok(String(error).includes(expectedMessage));
};

void test("zodObjectToOptique parses scalar options, derived long names, and Zod defaults", () => {
  const schema = z
    .strictObject({
      count: withCLI(z.int().default(DEFAULT_COUNT), { short: "-c" }),
      dialect: withCLI(z.enum(["draft-07", "draft-2020-12"]).default("draft-2020-12"), {
        long: "--schema-dialect",
        short: "-d",
      }),
      enabled: withCLI(z.boolean().default(false), { short: "-e" }),
      inputPath: withCLI(z.string(), {
        description: "Schema document path.",
        short: "-i",
        valueName: "FILE",
      }),
      ratio: withCLI(z.number().optional(), { short: "-r" }),
    })
    .readonly();

  assert.deepEqual(run(schema, ["-i", "schema.json"]), {
    count: 3,
    dialect: "draft-2020-12",
    enabled: false,
    inputPath: "schema.json",
  });

  assert.deepEqual(
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
    { count: 5, dialect: "draft-07", enabled: true, inputPath: "schema.json", ratio: 1.5 },
  );
});

void test("zodObjectToOptique parses boolean options as explicit values", () => {
  const schema = z.strictObject({ enabled: withCLI(z.boolean().default(true), { short: "-e" }) });

  assert.deepEqual(run(schema, ["--enabled", "false"]), { enabled: false });
  assert.deepEqual(run(schema, ["-e", "true"]), { enabled: true });
});

void test("zodObjectToOptique preserves absent optional arrays", () => {
  const schema = z.strictObject({
    include: withCLI(z.array(z.string()).default(["base.json"]), {
      long: "--include",
      short: "-I",
      valueName: "FILE",
    }),
    tags: withCLI(z.array(z.enum(["core", "cli"])).optional(), { short: "-t" }),
  });

  assert.deepEqual(run(schema, []), { include: ["base.json"] });
  assert.deepEqual(run(schema, ["--tags", "core"]), { include: ["base.json"], tags: ["core"] });
  assert.deepEqual(
    run(schema, ["--include", "a.json", "-I", "b.json", "-t", "core", "--tags", "cli"]),
    { include: ["a.json", "b.json"], tags: ["core", "cli"] },
  );
});

void test("zodObjectToOptiqueOverrides suppresses defaults and parses string-array metadata", () => {
  const schema = z.strictObject({
    dialect: withCLI(z.enum(["draft-7", "draft-2020-12"]).default("draft-2020-12"), {
      short: "-d",
    }),
    externalSchemas: withCLI(z.record(z.string(), z.string()).default({}), {
      long: "--external-schema",
      short: "-E",
      valueMode: "string-array",
      valueName: "ID=FILE",
    }),
  });

  assert.deepEqual(runOverrides(schema, []), {});
  assert.deepEqual(
    runOverrides(schema, [
      "--dialect",
      "draft-7",
      "-E",
      "a.json=b.json",
      "--external-schema",
      "c=d",
    ]),
    { dialect: "draft-7", externalSchemas: ["a.json=b.json", "c=d"] },
  );
});

void test("zodObjectToOptique requires at least one value for required array options", () => {
  const schema = z.strictObject({ refs: withCLI(z.array(z.string()), { short: "-r" }) });

  assert.throws(() => run(schema, []));
  assert.deepEqual(run(schema, ["--refs", "schema.json"]), { refs: ["schema.json"] });
});

void test("zodObjectToOptique finds metadata through supported wrappers", () => {
  const schema = z.strictObject({
    count: withCLI(z.int(), { short: "-c" }).optional(),
    mode: withCLI(z.enum(["fast", "strict"]), { short: "-m" }).default("fast"),
  });

  assert.deepEqual(run(schema, []), { mode: "fast" });
  assert.deepEqual(run(schema, ["--mode", "strict", "--count", "7"]), { count: 7, mode: "strict" });
});

void test("zodObjectToOptique runs final Zod validation after CLI value parsing", () => {
  const schema = z.strictObject({
    name: withCLI(z.string().min(MIN_NAME_LENGTH), { short: "-n" }),
  });

  assert.throws(() => run(schema, ["--name", "ab"]));
  assert.deepEqual(run(schema, ["--name", "abcd"]), { name: "abcd" });
});

void test("zodObjectToOptique rejects schemas without required CLI metadata", () => {
  const schema = z.strictObject({ input: z.string() });

  assert.throws(() => zodObjectToOptique(schema), ZodCLIOptionSchemaError);
  assertThrowsMessage(() => zodObjectToOptique(schema), "input: missing CLI option metadata");
});

void test("zodObjectToOptique rejects duplicate short or derived long option names", () => {
  const duplicateShort = z.strictObject({
    first: withCLI(z.string(), { short: "-x" }),
    second: withCLI(z.string(), { short: "-x" }),
  });
  const duplicateDerivedLong = z.strictObject({
    sourceProfile: withCLI(z.string(), { short: "-s" }),
    "source-profile": withCLI(z.string(), { short: "-p" }),
  });

  assertThrowsMessage(
    () => zodObjectToOptique(duplicateShort),
    "second: option name -x is already used by first",
  );
  assertThrowsMessage(
    () => zodObjectToOptique(duplicateDerivedLong),
    "source-profile: option name --source-profile is already used by sourceProfile",
  );
});

void test("zodObjectToOptique rejects invalid option metadata", () => {
  assertThrowsMessage(
    () => zodObjectToOptique(z.strictObject({ input: withCLI(z.string(), { short: "--input" }) })),
    "input: invalid short option name --input",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({ input: withCLI(z.string(), { long: "--1input", short: "-i" }) }),
      ),
    "input: invalid long option name --1input",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({ help: withCLI(z.string(), { long: "--help", short: "-h" }) }),
      ),
    "help: reserved help option name -h",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({
          input: withCLI(z.string(), { short: "-i", valueMode: "bytes" as never }),
        }),
      ),
    "input: unsupported CLI option value mode bytes",
  );
});

void test("zodObjectToOptique rejects unsupported root and field schema shapes", () => {
  assertThrowsMessage(
    () => zodObjectToOptique(withCLI(z.string(), { short: "-s" })),
    "<root>: expected a root Zod object schema",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({ nested: withCLI(z.strictObject({ value: z.string() }), { short: "-n" }) }),
      ),
    "nested: unsupported CLI option schema type object",
  );

  assertThrowsMessage(
    () => zodObjectToOptique(z.object({ input: withCLI(z.string(), { short: "-i" }) }).loose()),
    "<root>: object catchalls and passthrough keys are not supported",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({ records: withCLI(z.record(z.string(), z.string()), { short: "-r" }) }),
      ),
    "records: unsupported CLI option schema type record",
  );

  assertThrowsMessage(
    () =>
      zodObjectToOptique(
        z.strictObject({
          objects: withCLI(z.array(z.strictObject({ value: z.string() })), { short: "-o" }),
        }),
      ),
    "objects.<element>: unsupported CLI option schema type object",
  );
});
