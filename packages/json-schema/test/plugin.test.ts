import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jsonPointerSchema, parseZodEmissionModule } from "@x2zod/core";
import type {
  InputDocument,
  ZodEmissionModule,
  ZodEmissionModuleInput,
  ZodExpression,
} from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaInputPluginOptions, JsonSchemaInputPluginOptionsInput } from "../src";

const finalCallOffset = 1;
const externalSchemaUri = "https://opencode.ai/model-schema.json";

const fileDocument = (text: string): InputDocument => ({
  source: { kind: "file" as const, path: "/workspace/schema.json" },
  text,
});

const options = (input: JsonSchemaInputPluginOptionsInput = {}): JsonSchemaInputPluginOptions =>
  jsonSchemaInputPluginOptionsSchema.parse(input);

const expectOk = <TValue>(result: { ok: true; value: TValue } | { ok: false }): TValue => {
  assert.equal(result.ok, true);
  return result.value;
};

const expectErrCode = (
  result: { diagnostics?: readonly { code: string }[]; ok: boolean },
  code: string,
): void => {
  assert.equal(result.ok, false);
  assert.ok(diagnosticCodes(result).includes(code));
};

const diagnosticCodes = (result: {
  diagnostics?: readonly { code: string }[] | undefined;
}): readonly string[] => result.diagnostics?.map((diagnostic) => diagnostic.code) ?? [];

const diagnosticPointers = (result: {
  diagnostics?: readonly { location?: { pointer?: unknown } | undefined }[] | undefined;
}): readonly string[] =>
  result.diagnostics?.map((diagnostic) => String(diagnostic.location?.pointer)) ?? [];

const parseEmissionModule = (module: ZodEmissionModuleInput): ZodEmissionModule =>
  expectOk(parseZodEmissionModule(module));

const declarationSymbols = (module: ZodEmissionModule): readonly string[] =>
  module.declarations.map((declaration): string => declaration.symbol);

const rootExpression = (module: ZodEmissionModule): ZodExpression => {
  const root = module.declarations.find((declaration) => declaration.symbol === "root");
  if (root === undefined) throw new Error("Missing root declaration.");

  return root.expression;
};

const objectPropertyExpression = (expression: ZodExpression, key: string): ZodExpression => {
  if (expression.kind !== "factory") throw new Error("Expected factory expression.");

  const [shape] = expression.args;
  if (shape?.kind !== "object") throw new Error("Expected object expression.");

  const property = shape.properties.find((item) => item.key === key);
  if (property === undefined) throw new Error(`Missing property: ${key}`);

  return property.expression;
};

const stringLiteralArrayArgumentValues = (
  expression: ZodExpression,
  callIndex: number,
): string[] => {
  const argument = expression.calls[callIndex]?.args[0];
  if (argument?.kind !== "array") throw new Error("Expected array argument.");

  return argument.elements.map((element) => {
    if (element.kind !== "literal" || typeof element.value !== "string")
      throw new Error("Expected string literal array element.");
    return element.value;
  });
};

void describe("jsonSchemaInputPlugin prepare", () => {
  void test("parses strict JSON and records JSON Pointer source locations", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(
          [
            "{",
            '  "$schema": "https://json-schema.org/draft/2020-12/schema",',
            '  "type": "object",',
            '  "properties": { "name": { "type": "string" } }',
            "}",
          ].join("\n"),
        ),
        options({ validator: "none" }),
      ),
    );

    assert.equal(prepared.value.dialect, "draft-2020-12");
    assert.deepEqual(prepared.locations?.get(jsonPointerSchema.parse("/properties/name"))?.start, {
      column: 27,
      line: 4,
    });
  });

  void test("normalizes Ajv schema-document failures into diagnostics", async () => {
    const result = await jsonSchemaInputPlugin.prepare(
      fileDocument('{ "type": "wat" }'),
      options(),
    );

    expectErrCode(result, "invalid_schema_document");
    assert.equal(String(result.diagnostics?.at(0)?.location?.pointer), "/type");
  });

  void test("fails when declared and requested dialects conflict", async () => {
    const result = await jsonSchemaInputPlugin.prepare(
      fileDocument('{ "$schema": "http://json-schema.org/draft-07/schema#", "type": "string" }'),
      options({ dialect: "draft-2020-12", validator: "none" }),
    );

    expectErrCode(result, "dialect_conflict");
  });
});

void describe("jsonSchemaInputPlugin lower", () => {
  void test("lowers primitives, enums, objects, arrays, local refs, and additionalProperties", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(
          JSON.stringify({
            $defs: { tag: { type: "string" } },
            additionalProperties: false,
            properties: {
              count: { type: "integer" },
              mode: { enum: ["build", "watch"] },
              name: { type: "string" },
              tags: { items: { $ref: "#/$defs/tag" }, type: "array" },
            },
            required: ["name"],
            type: "object",
          }),
        ),
        options({ validator: "none" }),
      ),
    );

    const lowered = expectOk(
      await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" })),
    );
    const root = rootExpression(parseEmissionModule(lowered));

    assert.ok(
      lowered.declarations
        .map((declaration): string => declaration.symbol)
        .includes("schema:/$defs/tag"),
    );
    assert.equal(root.kind, "factory");
    assert.equal(root.calls.at(-finalCallOffset)?.method, "strict");
  });

  void test("fails loudly for known unsupported and unknown keywords", async () => {
    const unsupported = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument('{ "type": "array", "uniqueItems": true }'),
        options({ validator: "none" }),
      ),
    );
    expectErrCode(
      await jsonSchemaInputPlugin.lower(unsupported, options({ validator: "none" })),
      "unsupported_keyword",
    );

    const unknown = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument('{ "type": "object", "ref": "Config" }'),
        options({ validator: "none" }),
      ),
    );
    expectErrCode(
      await jsonSchemaInputPlugin.lower(unknown, options({ validator: "none" })),
      "unknown_keyword",
    );
  });

  void test("treats OpenCode ref metadata as inert profile data", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument('{ "type": "object", "ref": "Config" }'),
        options({ sourceProfile: "opencode", validator: "none" }),
      ),
    );
    const lowered = await jsonSchemaInputPlugin.lower(
      prepared,
      options({ sourceProfile: "opencode", validator: "none" }),
    );
    expectOk(lowered);

    assert.ok(diagnosticCodes(lowered).includes("json-schema/ignored-keyword"));
  });
});

void describe("jsonSchemaInputPlugin advanced lower", () => {
  void test("lowers external refs, numeric bounds, and anyOf branches", async () => {
    const pluginOptions = options({
      externalSchemas: {
        [externalSchemaUri]: { $defs: { model: { title: "Model", type: "string" } } },
      },
      validator: "none",
    });
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(
          JSON.stringify({
            additionalProperties: false,
            properties: {
              count: { exclusiveMaximum: 10, minimum: 1, type: "integer" },
              model: { $ref: `${externalSchemaUri}#/$defs/model` },
              value: { anyOf: [{ type: "string" }, { maximum: 5, type: "number" }] },
            },
            required: ["count", "model", "value"],
            type: "object",
          }),
        ),
        pluginOptions,
      ),
    );

    const lowered = parseEmissionModule(
      expectOk(await jsonSchemaInputPlugin.lower(prepared, pluginOptions)),
    );
    const root = rootExpression(lowered);
    const count = objectPropertyExpression(root, "count");
    const model = objectPropertyExpression(root, "model");
    const value = objectPropertyExpression(root, "value");

    assert.ok(
      declarationSymbols(lowered).includes(
        ["schema:", externalSchemaUri, "#/$defs/model"].join(""),
      ),
    );
    assert.deepEqual(
      count.calls.map((call) => String(call.method)),
      ["int", "gte", "lt"],
    );
    assert.equal(model.kind, "reference");
    assert.equal(String(model.symbol), `schema:${externalSchemaUri}#/$defs/model`);
    assert.equal(value.kind, "factory");
    assert.equal(value.factory, "union");
  });
});

void describe("jsonSchemaInputPlugin precise lower", () => {
  void test("lowers array bounds, string patterns, fixed tuples, and required unknown keys", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(
          JSON.stringify({
            properties: {
              pair: {
                maxItems: 2,
                minItems: 2,
                prefixItems: [{ type: "string" }, { type: "number" }],
                type: "array",
              },
              slug: { maxLength: 8, minLength: 3, pattern: "^[a-z]+$", type: "string" },
              tags: { items: { type: "string" }, maxItems: 3, minItems: 1, type: "array" },
              value: {},
            },
            required: ["value", "metadata"],
            type: "object",
          }),
        ),
        options({ validator: "none" }),
      ),
    );

    const lowered = parseEmissionModule(
      expectOk(await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }))),
    );
    const root = rootExpression(lowered);
    const metadata = objectPropertyExpression(root, "metadata");
    const pair = objectPropertyExpression(root, "pair");
    const slug = objectPropertyExpression(root, "slug");
    const tags = objectPropertyExpression(root, "tags");
    const value = objectPropertyExpression(root, "value");

    assert.deepEqual(
      root.calls.map((call) => String(call.method)),
      ["required", "passthrough"],
    );
    assert.deepEqual(stringLiteralArrayArgumentValues(root, 0), ["value", "metadata"]);
    assert.equal(metadata.kind, "factory");
    assert.equal(metadata.factory, "unknown");
    assert.equal(value.kind, "factory");
    assert.equal(value.factory, "unknown");
    assert.equal(pair.kind, "factory");
    assert.equal(pair.factory, "tuple");
    assert.deepEqual(
      slug.calls.map((call) => String(call.method)),
      ["regex", "min", "max", "optional"],
    );
    assert.deepEqual(
      tags.calls.map((call) => String(call.method)),
      ["min", "max", "optional"],
    );
  });

  void test("lowers required-only object schemas into required shape keys", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ required: ["metadata"] })),
        options({ validator: "none" }),
      ),
    );

    const lowered = parseEmissionModule(
      expectOk(await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }))),
    );
    const root = rootExpression(lowered);
    const metadata = objectPropertyExpression(root, "metadata");

    assert.deepEqual(
      root.calls.map((call) => String(call.method)),
      ["required", "passthrough"],
    );
    assert.deepEqual(stringLiteralArrayArgumentValues(root, 0), ["metadata"]);
    assert.equal(metadata.kind, "factory");
    assert.equal(metadata.factory, "unknown");
  });

  void test("allows redundant integer type siblings for integer const and enum literals", async () => {
    const cases = [
      { const: 1, type: "integer" },
      { enum: [1, 2], type: "integer" },
    ];
    const results = await Promise.all(
      cases.map(async (schema) => {
        const prepared = expectOk(
          await jsonSchemaInputPlugin.prepare(
            fileDocument(JSON.stringify(schema)),
            options({ validator: "none" }),
          ),
        );

        return jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));
      }),
    );

    for (const result of results) expectOk(result);
  });
});

void describe("jsonSchemaInputPlugin precise diagnostics", () => {
  void test("diagnoses malformed required arrays without validator preflight", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ required: ["name", "name", true], type: "object" })),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "invalid_schema_document");
    const pointers =
      result.diagnostics?.map((diagnostic) => String(diagnostic.location?.pointer)) ?? [];
    assert.ok(pointers.includes("/required/1"));
    assert.ok(pointers.includes("/required/2"));
  });

  void test("diagnoses malformed enum and type keywords without validator preflight", async () => {
    const cases = [
      { expectedPointer: "/enum", schema: { enum: "build" } },
      { expectedPointer: "/type", schema: { type: true } },
    ];
    const results = await Promise.all(
      cases.map(async ({ expectedPointer, schema }) => {
        const prepared = expectOk(
          await jsonSchemaInputPlugin.prepare(
            fileDocument(JSON.stringify(schema)),
            options({ validator: "none" }),
          ),
        );
        const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));
        return { expectedPointer, result };
      }),
    );

    for (const { expectedPointer, result } of results) {
      expectErrCode(result, "invalid_schema_document");
      assert.ok(diagnosticPointers(result).includes(expectedPointer));
    }
  });

  void test("collects unsupported keyword diagnostics from referenced external schemas", async () => {
    const pluginOptions = options({
      externalSchemas: {
        [externalSchemaUri]: { $defs: { tags: { type: "array", uniqueItems: true } } },
      },
      validator: "none",
    });
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ $ref: `${externalSchemaUri}#/$defs/tags` })),
        pluginOptions,
      ),
    );

    const result = await jsonSchemaInputPlugin.lower(prepared, pluginOptions);

    expectErrCode(result, "unsupported_keyword");
    assert.ok(diagnosticPointers(result).includes("/$defs/tags/uniqueItems"));
  });

  void test("fails when keyword-specific lowerers would ignore sibling assertions", async () => {
    const cases = [
      { $defs: { value: { type: "string" } }, $ref: "#/$defs/value", type: "number" },
      { const: "build", type: "number" },
      { enum: ["build", "watch"], type: "number" },
      { anyOf: [{ type: "string" }], type: "string" },
    ];

    const results = await Promise.all(
      cases.map(async (schema) => {
        const prepared = expectOk(
          await jsonSchemaInputPlugin.prepare(
            fileDocument(JSON.stringify(schema)),
            options({ validator: "none" }),
          ),
        );

        return jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));
      }),
    );

    for (const result of results) expectErrCode(result, "unrepresentable_schema_combination");
  });
});

void describe("jsonSchemaInputPlugin regression diagnostics", () => {
  void test("diagnoses malformed numeric bounds without validator preflight", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ minimum: "1", type: "number" })),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "invalid_schema_document");
    assert.ok(diagnosticPointers(result).includes("/minimum"));
  });

  void test("fails when string pattern constraints omit a string type", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ pattern: "^a$" })),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "unrepresentable_schema_combination");
    assert.ok(diagnosticPointers(result).includes("/pattern"));
  });

  void test("does not resolve partial array-index tokens in JSON Pointers", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(
          JSON.stringify({
            $defs: {
              tuple: {
                maxItems: 2,
                minItems: 2,
                prefixItems: [{ type: "string" }, { type: "number" }],
                type: "array",
              },
            },
            $ref: "#/$defs/tuple/prefixItems/1foo",
          }),
        ),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "unresolved_reference");
  });
});
