import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMessage, getDocPageSync, parseSync } from "@optique/core";
import { z } from "zod/v4";

import { ok, zodFactory } from "@x2zod/core";

import { resolveX2ZodInputPluginRegistry } from "../src";
import {
  assertSupportedZodCLIOptionSchema,
  withCLI,
  zodObjectToOptique,
  zodObjectToOptiqueOverrides,
} from "../src/zod-to-optique";

void test("registration and parser construction do not evaluate default factories", () => {
  let defaults = 0;
  const schema = z.strictObject({
    name: withCLI(
      z.string().default(() => {
        defaults += 1;
        return `default-${defaults.toString()}`;
      }),
      { short: "-n" },
    ),
  });

  assertSupportedZodCLIOptionSchema(schema);
  const registry = resolveX2ZodInputPluginRegistry({
    plugins: {
      input: {
        example: {
          kind: "example",
          optionsSchema: schema,
          prepare: async () => {
            await Promise.resolve();
            return ok({ value: undefined });
          },
          lower: async () => {
            await Promise.resolve();
            return ok({
              declarations: [{ expression: zodFactory("string"), symbol: "root" }],
              root: "root",
            });
          },
        },
      },
    },
  });
  assert.equal(registry.plugins.example.optionsSchema, schema);
  const parser = zodObjectToOptique(schema);
  const overrides = zodObjectToOptiqueOverrides(schema);
  assert.equal(defaults, 0);
  assert.deepEqual(parseSync(overrides, []), { success: true, value: {} });
  assert.deepEqual(parseSync(parser, ["--name", "explicit"]), {
    success: true,
    value: { name: "explicit" },
  });
  assert.equal(defaults, 0);
  assert.deepEqual(parseSync(parser, []), { success: true, value: { name: "default-1" } });
  assert.deepEqual(parseSync(parser, []), { success: true, value: { name: "default-2" } });
  assert.equal(defaults, 2);
});

void test("default overwrites and refinements run only in final Zod option validation", () => {
  let overwrites = 0;
  let refinements = 0;
  const schema = z.strictObject({
    name: withCLI(
      z
        .string()
        .default("default")
        .overwrite((value) => {
          overwrites += 1;
          return `${value}!`;
        })
        .refine((value) => {
          refinements += 1;
          return value !== "invalid!";
        }),
      { short: "-n" },
    ),
  });

  assertSupportedZodCLIOptionSchema(schema);
  const parser = zodObjectToOptique(schema);
  const overrides = zodObjectToOptiqueOverrides(schema);
  assert.deepEqual([overwrites, refinements], [0, 0]);
  assert.deepEqual(parseSync(overrides, []), { success: true, value: {} });
  assert.deepEqual(parseSync(parser, []), { success: true, value: { name: "default!" } });
  assert.deepEqual([overwrites, refinements], [1, 1]);
  assert.deepEqual(parseSync(parser, ["--name", "supplied"]), {
    success: true,
    value: { name: "supplied!" },
  });
  assert.deepEqual([overwrites, refinements], [2, 2]);
  const expectedParseCount = 3;
  assert.throws(() => parseSync(parser, ["--name", "invalid"]), z.ZodError);
  assert.deepEqual([overwrites, refinements], [expectedParseCount, expectedParseCount]);
});

void test("optional wrapper combinations preserve Zod's absent-field behavior", () => {
  const schema = z.strictObject({
    defaultOptional: withCLI(z.string().default("first").optional().readonly(), { short: "-a" }),
    optionalDefault: withCLI(z.string().optional().default("second").readonly(), { short: "-b" }),
    exact: withCLI(z.string().exactOptional().readonly(), { short: "-c" }),
    optional: withCLI(z.string().optional().readonly(), { short: "-d" }),
  });

  assertSupportedZodCLIOptionSchema(schema);
  assert.deepEqual(parseSync(zodObjectToOptique(schema), []), {
    success: true,
    value: schema.parse({}),
  });
  assert.deepEqual(parseSync(zodObjectToOptiqueOverrides(schema), []), {
    success: true,
    value: {},
  });
});

void test("help retains default previews without evaluating them during parser construction", () => {
  let defaults = 0;
  let optionalRefinements = 0;
  const schema = z.strictObject({
    name: withCLI(
      z.string().default(() => {
        defaults += 1;
        return "preview";
      }),
      { short: "-n" },
    ),
    optional: withCLI(
      z
        .string()
        .optional()
        .refine((value) => {
          optionalRefinements += 1;
          return value !== undefined;
        }),
      { short: "-o" },
    ),
  });

  const parser = zodObjectToOptique(schema);
  assert.equal(defaults, 0);
  assert.equal(optionalRefinements, 0);
  const page = getDocPageSync(parser);
  const entries = page?.sections.flatMap((section) => section.entries);
  const entry = entries?.[0];
  assert.notEqual(entry?.default, undefined);
  assert.match(formatMessage(entry?.default ?? []), /preview/u);
  assert.equal(defaults, 1);
  assert.equal(entries?.[1]?.default, undefined);
  assert.equal(optionalRefinements, 1);
});

void test("CLI value modes preserve defaults inside opaque option-schema shapes", () => {
  let defaults = 0;
  const schema = z.strictObject({
    entries: withCLI(
      z.union([
        z.array(z.string()).default(() => {
          defaults += 1;
          return ["default"];
        }),
        z.string(),
      ]),
      { short: "-e", valueMode: "string-array" },
    ),
  });

  assertSupportedZodCLIOptionSchema(schema);
  const parser = zodObjectToOptique(schema);
  assert.equal(defaults, 0);
  assert.deepEqual(parseSync(parser, []), { success: true, value: { entries: ["default"] } });
  assert.equal(defaults, 1);
  assert.deepEqual(parseSync(parser, ["--entries", "value"]), {
    success: true,
    value: { entries: ["value"] },
  });
  assert.equal(defaults, 1);
  const page = getDocPageSync(parser);
  const entry = page?.sections.flatMap((section) => section.entries)[0];
  assert.notEqual(entry?.default, undefined);
  assert.match(formatMessage(entry?.default ?? []), /default/u);
  assert.equal(defaults, 2);
});

void test("help uses Zod's omitted value through lazy pipelines and optional overwrites", () => {
  let transforms = 0;
  let overwrites = 0;
  const schema = z.strictObject({
    entries: withCLI(
      z.lazy(() =>
        z
          .array(z.string())
          .default(["base"])
          .transform((values) => {
            transforms += 1;
            return values.map((value) => `${value}-transformed`);
          }),
      ),
      { short: "-e", valueMode: "string-array" },
    ),
    name: withCLI(
      z
        .string()
        .optional()
        .overwrite((value) => {
          overwrites += 1;
          return value ?? "name-preview";
        }),
      { short: "-n" },
    ),
  });

  assertSupportedZodCLIOptionSchema(schema);
  const parser = zodObjectToOptique(schema);
  const overrides = zodObjectToOptiqueOverrides(schema);
  assert.deepEqual([transforms, overwrites], [0, 0]);
  const overrideEntries = getDocPageSync(overrides)?.sections.flatMap((section) => section.entries);
  assert.equal(
    overrideEntries?.every((entry) => entry.default === undefined),
    true,
  );
  assert.deepEqual([transforms, overwrites], [0, 0]);
  const entries = getDocPageSync(parser)?.sections.flatMap((section) => section.entries);
  assert.match(formatMessage(entries?.[0]?.default ?? []), /base-transformed/u);
  assert.match(formatMessage(entries?.[1]?.default ?? []), /name-preview/u);
  assert.deepEqual([transforms, overwrites], [1, 1]);
  assert.deepEqual(parseSync(parser, []), {
    success: true,
    value: { entries: ["base-transformed"], name: "name-preview" },
  });
  assert.deepEqual([transforms, overwrites], [2, 2]);
});

void test("registration rejects unsupported fields without evaluating earlier defaults", () => {
  let defaults = 0;
  const schema = z.strictObject({
    name: withCLI(
      z.string().default(() => {
        defaults += 1;
        return "default";
      }),
      { short: "-n" },
    ),
    nested: withCLI(z.strictObject({ value: z.string() }), { short: "-v" }),
  });

  assert.throws(() => {
    assertSupportedZodCLIOptionSchema(schema);
  }, /nested: unsupported CLI option schema type object/u);
  assert.equal(defaults, 0);
});
