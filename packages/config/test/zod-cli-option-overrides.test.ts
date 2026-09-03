import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod/v4";

import {
  mergeZodCLIOptionOverrides,
  resolveZodCLIOptionOverrides,
} from "../src/zod-cli-option-overrides";
import { withCLI } from "../src/zod-to-optique";

const valueTypeSchema = z.enum(["string", "boolean", "number", "null"]);
const optionsSchema = z
  .strictObject({
    inertKeywords: withCLI(z.record(z.string(), valueTypeSchema).default({}).readonly(), {
      long: "--inert-keyword",
      short: "-K",
      valueMode: "string-map",
      valueName: "NAME=TYPE",
    }),
  })
  .readonly();
const context = {
  baseDirectory: "/repo",
  readTextFile: async (): Promise<string> => {
    await Promise.resolve();
    throw new Error("Unexpected file read");
  },
};

void test("resolveZodCLIOptionOverrides parses string-map values with last occurrence winning", async () => {
  const resolved = await resolveZodCLIOptionOverrides(
    optionsSchema,
    {
      inertKeywords: [
        "xStringMetadata=string",
        "xBooleanMetadata=boolean",
        "xStringMetadata=number",
        "custom=value=with=equals",
      ],
    },
    context,
  );

  assert.deepEqual(resolved, {
    inertKeywords: {
      custom: "value=with=equals",
      xBooleanMetadata: "boolean",
      xStringMetadata: "number",
    },
  });
});

void test("mergeZodCLIOptionOverrides merges string maps with CLI values winning", async () => {
  const merged = await mergeZodCLIOptionOverrides({
    context,
    existingOptions: { inertKeywords: { configuredOnly: "number", xBooleanMetadata: "string" } },
    overrides: { inertKeywords: ["xBooleanMetadata=boolean", "cliOnly=null"] },
    schema: optionsSchema,
  });

  assert.deepEqual(merged, {
    inertKeywords: { cliOnly: "null", configuredOnly: "number", xBooleanMetadata: "boolean" },
  });
});

void test("resolveZodCLIOptionOverrides rejects malformed string-map values", async () => {
  await Promise.all(
    ["missing-separator", "=string", "keyword="].map(async (value) => {
      await assert.rejects(
        resolveZodCLIOptionOverrides(optionsSchema, { inertKeywords: [value] }, context),
        /inertKeywords: expected NAME=TYPE option values/u,
      );
    }),
  );
});

void test("string-map values remain subject to final Zod record validation", async () => {
  const resolved = await resolveZodCLIOptionOverrides(
    optionsSchema,
    { inertKeywords: ["xStringMetadata=text"] },
    context,
  );

  assert.throws(() => optionsSchema.parse(resolved), z.ZodError);
});
