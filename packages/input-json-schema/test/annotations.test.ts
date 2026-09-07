import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { compileToZodSource, printSourceFile } from "@x2zod/core";
import type { CompileToZodSourceResult, ZodEmissionTransformInput } from "@x2zod/core";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  runNode,
} from "../../../test/native-source-harness";
import { createJsonSchemaInputPlugin, jsonSchemaInputPlugin } from "../src";
import type {
  JsonSchemaAnnotationContext,
  JsonSchemaAnnotationProjector,
  JsonSchemaInputPluginOptionsInput,
  JsonSchemaValue,
} from "../src";

const compileSchema = async (
  schema: JsonSchemaValue,
  pluginOptions: JsonSchemaInputPluginOptionsInput = {},
  extensions: Readonly<{
    projectAnnotations?: JsonSchemaAnnotationProjector;
    transforms?: readonly ZodEmissionTransformInput[];
  }> = {},
): Promise<CompileToZodSourceResult> => {
  const result = await compileToZodSource({
    document: {
      source: { id: "annotations", kind: "inline" },
      retrievalUri: "https://example.test/root",
      text: JSON.stringify(schema),
    },
    output: { typeName: "Annotated" },
    plugin: createJsonSchemaInputPlugin(
      extensions.projectAnnotations === undefined
        ? {}
        : { projectAnnotations: extensions.projectAnnotations },
    ),
    pluginOptions,
    transforms: extensions.transforms,
  });
  return result;
};

const runtimeCheck = async (
  result: Awaited<ReturnType<typeof compileSchema>>,
  assertions: string,
): Promise<void> => {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const directory = createTemporaryDirectory({
    prefix: "annotations-",
    rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
  });
  try {
    const file = nodePath.join(directory, "generated.ts");
    await writeFile(file, await printSourceFile(result.value.sourceFile, { cwd: process.cwd() }));
    const bundle = nodePath.join(directory, "generated.mjs");
    buildNodeBundle({ cwd: directory, entryPoint: file, outfile: bundle, externals: ["zod/v4"] });
    runNode({
      args: [
        "--input-type=module",
        "-e",
        [
          'import assert from "node:assert/strict";',
          "const { annotatedSchema: schema } = await import(process.argv[1]);",
          assertions,
        ].join("\n"),
        pathToFileURL(bundle).href,
      ],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

for (const enabled of [false, true])
  void test(`description emission enabled=${String(enabled)} leaves validation unchanged`, async () => {
    const result = await compileSchema(
      { description: "A label.", minLength: 1, type: "string" },
      { annotationKeywords: { description: enabled } },
    );
    await runtimeCheck(
      result,
      `assert.equal(schema.description, ${enabled ? '"A label."' : "undefined"}); assert.equal(schema.safeParse("x").success, true); assert.equal(schema.safeParse("").success, false);`,
    );
  });

void test("preserves opaque annotations and external identities without collecting declaration containers", async () => {
  const contexts: JsonSchemaAnnotationContext[] = [];
  const external = "https://example.test/external";
  const result = await compileSchema(
    {
      $ref: external,
      description: "Reference site.",
      definitions: { unused: { description: "Not emitted.", type: "string" } },
      vendor: { anyOf: ["opaque"], $ref: "not-a-schema-reference" },
    },
    {
      sourceProfile: "opencode",
      externalSchemas: {
        [external]: { description: "Target.", type: "string" },
        "https://example.test/unused": { description: "Unreachable.", type: "string" },
      },
    },
    {
      projectAnnotations: (context) => {
        contexts.push(context);
        assert.ok(Object.isFrozen(context));
        assert.ok(Object.isFrozen(context.annotations));
        const vendor = context.annotations.find((annotation) => annotation.keyword === "vendor");
        if (vendor !== undefined) {
          assert.deepEqual(vendor.value, { anyOf: ["opaque"], $ref: "not-a-schema-reference" });
          assert.ok(Object.isFrozen(vendor.value));
          assert.equal(vendor.pointer, "/vendor");
        }
        return { description: context.retrievalUri };
      },
    },
  );
  assert.deepEqual(contexts.map((context) => context.retrievalUri).toSorted(), [
    external,
    "https://example.test/root",
  ]);
  assert.ok(contexts.every((context) => context.pointer === ""));
  assert.ok(
    contexts.every((context) =>
      context.annotations.every((annotation) => annotation.keyword !== "definitions"),
    ),
  );
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.description, "https://example.test/root");',
      'assert.equal(schema.safeParse("x").success, true);',
      "assert.equal(schema.safeParse(1).success, false);",
    ].join("\n"),
  );
});

void test("projects composition nodes once and retains metadata on guarded exports", async () => {
  const contexts: JsonSchemaAnnotationContext[] = [];
  const result = await compileSchema(
    {
      description: "Exactly one.",
      minLength: 2,
      oneOf: [{ type: "string", description: "Text." }, { const: "special" }],
      type: "string",
    },
    { annotationKeywords: { description: true } },
    {
      projectAnnotations: (context) => {
        contexts.push(context);
        return {};
      },
    },
  );
  assert.deepEqual(contexts.map((context) => context.pointer).toSorted(), ["", "/oneOf/0"]);
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.description, "Exactly one.");',
      'assert.equal(schema.safeParse("ordinary").success, true);',
      'assert.equal(schema.safeParse("special").success, false);',
      'assert.equal(schema.safeParse("x").success, false);',
    ].join("\n"),
  );
});

for (const keyword of ["anyOf", "oneOf"] as const)
  void test(`preserves ${keyword} annotations through object branch normalization`, async () => {
    const contexts: JsonSchemaAnnotationContext[] = [];
    const result = await compileSchema(
      {
        description: "Parent.",
        type: "object",
        [keyword]: [
          {
            description: "First branch.",
            properties: { kind: { const: "first" } },
            required: ["kind"],
          },
          {
            description: "Second branch.",
            type: "object",
            properties: { kind: { const: "second" } },
            required: ["kind"],
          },
        ],
      },
      { annotationKeywords: { description: true } },
      {
        projectAnnotations: (context) => {
          contexts.push(context);
          return {};
        },
      },
    );
    assert.deepEqual(contexts.map((context) => context.pointer).toSorted(), [
      "",
      `/${keyword}/0`,
      `/${keyword}/1`,
    ]);
    await runtimeCheck(
      result,
      [
        'assert.equal(schema.description, "Parent.");',
        'assert.deepEqual(schema.options.map(branch => branch.description), ["First branch.", "Second branch."]);',
        'assert.equal(schema.safeParse({ kind: "first" }).success, true);',
        'assert.equal(schema.safeParse({ kind: "second" }).success, true);',
        'assert.equal(schema.safeParse({ kind: "other" }).success, false);',
        'assert.equal(schema.safeParse("first").success, false);',
      ].join("\n"),
    );
  });

void test("projects vendor metadata through a typed description result", async () => {
  const result = await compileSchema(
    { type: "string", vendor: { documentation: "Vendor docs." } },
    {},
    {
      projectAnnotations: (context) => {
        const value = context.annotations.find(
          (annotation) => annotation.keyword === "vendor",
        )?.value;
        return typeof value === "object" &&
          value !== null &&
          "documentation" in value &&
          typeof value["documentation"] === "string"
          ? { description: value["documentation"] }
          : {};
      },
    },
  );
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.description, "Vendor docs.");',
      "assert.equal(schema.safeParse(1).success, false);",
    ].join("\n"),
  );
});

const invalidProjectors: readonly JsonSchemaAnnotationProjector[] = [
  (): Readonly<{ description: string; validation: boolean }> => ({
    description: "x",
    validation: true,
  }),
  (): never => {
    throw new Error("projection failed");
  },
];
for (const [index, projectAnnotations] of invalidProjectors.entries())
  void test(`reports invalid projector ${index.toString()} as a plugin failure`, async () => {
    const result = await compileSchema(
      { type: "string", vendor: true },
      {},
      { projectAnnotations },
    );
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "plugin_exception"));
  });

void test("annotation keyword configuration rejects unsupported names", () => {
  assert.equal(
    jsonSchemaInputPlugin.optionsSchema.safeParse({ annotationKeywords: { title: true } }).success,
    false,
  );
});

void test("retains root description on runtime guards and property codecs", async () => {
  const result = await compileSchema(
    {
      description: "Guarded object.",
      type: "object",
      properties: { user_name: { type: "string" } },
      required: ["user_name"],
      unevaluatedProperties: false,
    },
    { annotationKeywords: { description: true } },
    {
      transforms: [
        { kind: "map-properties", options: { keys: { kind: "case", decodedCase: "camelCase" } } },
      ],
    },
  );
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.description, "Guarded object.");',
      'assert.deepEqual(schema.parse({ user_name: "Ada" }), { userName: "Ada" });',
      'assert.equal(schema.safeParse({ user_name: "Ada", extra: true }).success, false);',
    ].join("\n"),
  );
});

void test("keeps recursive declaration descriptions separate from reference-site descriptions", async () => {
  const result = await compileSchema(
    {
      $defs: {
        node: {
          type: "object",
          description: "Node.",
          properties: { next: { $ref: "#/$defs/node", description: "Next node." } },
        },
      },
      $ref: "#/$defs/node",
      description: "Root node.",
    },
    { annotationKeywords: { description: true } },
  );
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.description, "Root node.");',
      "assert.equal(schema.safeParse({ next: {} }).success, true);",
      "assert.equal(schema.safeParse({ next: 3 }).success, false);",
    ].join("\n"),
  );
});

void test("does not project ignored Draft 7 reference siblings", async () => {
  const contexts: JsonSchemaAnnotationContext[] = [];
  const result = await compileSchema(
    {
      definitions: { value: { type: "string", description: "Target." } },
      $ref: "#/definitions/value",
      description: "Ignored sibling.",
    },
    { dialect: "draft-7", annotationKeywords: { description: true } },
    {
      projectAnnotations: (context) => {
        contexts.push(context);
        return {};
      },
    },
  );
  assert.ok(contexts.every((context) => context.pointer !== ""));
  await runtimeCheck(result, 'assert.equal(schema.description, "Target.");');
});

void test("does not project ignored Draft 7 annotations on normalized reference branches", async () => {
  const contexts: JsonSchemaAnnotationContext[] = [];
  const result = await compileSchema(
    {
      definitions: {
        first: { type: "object", description: "First target." },
        second: { type: "object", description: "Second target." },
      },
      type: "object",
      anyOf: [
        { $ref: "#/definitions/first", description: "Ignored first sibling." },
        { $ref: "#/definitions/second", description: "Ignored second sibling." },
      ],
    },
    { dialect: "draft-7", annotationKeywords: { description: true } },
    {
      projectAnnotations: (context) => {
        contexts.push(context);
        return {};
      },
    },
  );
  assert.deepEqual(contexts.map((context) => context.pointer).toSorted(), [
    "/definitions/first",
    "/definitions/second",
  ]);
  await runtimeCheck(
    result,
    "assert.deepEqual(schema.options.map(branch => branch.description), " +
      '["First target.", "Second target."]);',
  );
});

for (const unknownKeywords of ["warn", "ignore"] as const)
  void test(`keeps Ajv extensions inert under ${unknownKeywords}`, async () => {
    const result = await compileSchema(
      { type: "string", nullable: true, not: { const: "x" } },
      { unknownKeywords },
    );
    await runtimeCheck(
      result,
      [
        'assert.equal(schema.safeParse("value").success, true);',
        'assert.equal(schema.safeParse("x").success, false);',
        "assert.equal(schema.safeParse(null).success, false);",
      ].join("\n"),
    );
  });

void test("preserves explicit targets inside inert containers without giving the container semantics", async () => {
  const result = await compileSchema(
    { $ref: "#/nullable/target", nullable: { target: { type: "string", not: { const: "x" } } } },
    { inertKeywords: { nullable: "object" } },
  );
  await runtimeCheck(
    result,
    [
      'assert.equal(schema.safeParse("value").success, true);',
      'assert.equal(schema.safeParse("x").success, false);',
      "assert.equal(schema.safeParse(null).success, false);",
    ].join("\n"),
  );
});
