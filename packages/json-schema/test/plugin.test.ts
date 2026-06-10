import { describe, expect, test } from "bun:test";

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
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected result to be ok.");
  return result.value;
};

const expectErrCode = (
  result: { diagnostics?: readonly { code: string }[]; ok: boolean },
  code: string,
): void => {
  expect(result.ok).toBe(false);
  expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(code);
};

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

describe("jsonSchemaInputPlugin prepare", () => {
  test("parses strict JSON and records JSON Pointer source locations", async () => {
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

    expect(prepared.value.dialect).toBe("draft-2020-12");
    expect(prepared.locations?.get(jsonPointerSchema.parse("/properties/name"))?.start).toEqual({
      column: 27,
      line: 4,
    });
  });

  test("normalizes Ajv schema-document failures into diagnostics", async () => {
    const result = await jsonSchemaInputPlugin.prepare(
      fileDocument('{ "type": "wat" }'),
      options(),
    );

    expectErrCode(result, "invalid_schema_document");
    expect(String(result.diagnostics?.at(0)?.location?.pointer)).toBe("/type");
  });

  test("fails when declared and requested dialects conflict", async () => {
    const result = await jsonSchemaInputPlugin.prepare(
      fileDocument('{ "$schema": "http://json-schema.org/draft-07/schema#", "type": "string" }'),
      options({ dialect: "draft-2020-12", validator: "none" }),
    );

    expectErrCode(result, "dialect_conflict");
  });
});

describe("jsonSchemaInputPlugin lower", () => {
  test("lowers primitives, enums, objects, arrays, local refs, and additionalProperties", async () => {
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
    const root = lowered.declarations.find((declaration) => declaration.symbol === "root");

    expect(lowered.declarations.map((declaration): string => declaration.symbol)).toContain(
      "schema:/$defs/tag",
    );
    expect(root?.expression.kind).toBe("factory");
    expect(root?.expression.calls?.at(-finalCallOffset)?.method).toBe("strict");
  });

  test("fails loudly for known unsupported and unknown keywords", async () => {
    const unsupported = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument('{ "type": "string", "minLength": 3 }'),
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

  test("treats OpenCode ref metadata as inert profile data", async () => {
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

    expect(lowered.diagnostics?.map((diagnostic) => String(diagnostic.code))).toContain(
      "json-schema/ignored-keyword",
    );
  });
});

describe("jsonSchemaInputPlugin advanced lower", () => {
  test("lowers external refs, numeric bounds, and anyOf branches", async () => {
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

    expect(declarationSymbols(lowered)).toContain(
      ["schema:", externalSchemaUri, "#/$defs/model"].join(""),
    );
    expect(count.calls.map((call) => String(call.method))).toEqual(["int", "gte", "lt"]);
    expect(model.kind).toBe("reference");
    if (model.kind !== "reference") throw new Error("Expected model to lower to a reference.");
    expect(String(model.symbol)).toBe(`schema:${externalSchemaUri}#/$defs/model`);
    expect(value.kind).toBe("factory");
    if (value.kind !== "factory") throw new Error("Expected value to lower to a factory.");
    expect(value.factory).toBe("union");
  });
});

describe("jsonSchemaInputPlugin precise lower", () => {
  test("lowers array bounds, string patterns, fixed tuples, and required unknown keys", async () => {
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
              slug: { pattern: "^[a-z]+$", type: "string" },
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

    expect(root.calls.map((call) => String(call.method))).toEqual(["required", "passthrough"]);
    expect(stringLiteralArrayArgumentValues(root, 0)).toEqual(["value", "metadata"]);
    expect(metadata.kind).toBe("factory");
    if (metadata.kind !== "factory") throw new Error("Expected metadata to lower to a factory.");
    expect(metadata.factory).toBe("unknown");
    expect(value.kind).toBe("factory");
    if (value.kind !== "factory") throw new Error("Expected value to lower to a factory.");
    expect(value.factory).toBe("unknown");
    expect(pair.kind).toBe("factory");
    if (pair.kind !== "factory") throw new Error("Expected pair to lower to a factory.");
    expect(pair.factory).toBe("tuple");
    expect(slug.calls.map((call) => String(call.method))).toEqual(["regex", "optional"]);
    expect(tags.calls.map((call) => String(call.method))).toEqual(["min", "max", "optional"]);
  });

  test("lowers required-only object schemas into required shape keys", async () => {
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

    expect(root.calls.map((call) => String(call.method))).toEqual(["required", "passthrough"]);
    expect(stringLiteralArrayArgumentValues(root, 0)).toEqual(["metadata"]);
    expect(metadata.kind).toBe("factory");
    if (metadata.kind !== "factory") throw new Error("Expected metadata to lower to a factory.");
    expect(metadata.factory).toBe("unknown");
  });
});

describe("jsonSchemaInputPlugin precise diagnostics", () => {
  test("diagnoses malformed required arrays without validator preflight", async () => {
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
    expect(pointers).toContain("/required/1");
    expect(pointers).toContain("/required/2");
  });

  test("collects unsupported keyword diagnostics from referenced external schemas", async () => {
    const pluginOptions = options({
      externalSchemas: {
        [externalSchemaUri]: { $defs: { model: { minLength: 3, type: "string" } } },
      },
      validator: "none",
    });
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ $ref: `${externalSchemaUri}#/$defs/model` })),
        pluginOptions,
      ),
    );

    const result = await jsonSchemaInputPlugin.lower(prepared, pluginOptions);

    expectErrCode(result, "unsupported_keyword");
    expect(result.diagnostics?.map((diagnostic) => String(diagnostic.location?.pointer))).toContain(
      "/$defs/model/minLength",
    );
  });

  test("fails when keyword-specific lowerers would ignore sibling assertions", async () => {
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

describe("jsonSchemaInputPlugin regression diagnostics", () => {
  test("diagnoses malformed numeric bounds without validator preflight", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ minimum: "1", type: "number" })),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "invalid_schema_document");
    expect(result.diagnostics?.map((diagnostic) => String(diagnostic.location?.pointer))).toContain(
      "/minimum",
    );
  });

  test("fails when string pattern constraints omit a string type", async () => {
    const prepared = expectOk(
      await jsonSchemaInputPlugin.prepare(
        fileDocument(JSON.stringify({ pattern: "^a$" })),
        options({ validator: "none" }),
      ),
    );
    const result = await jsonSchemaInputPlugin.lower(prepared, options({ validator: "none" }));

    expectErrCode(result, "unrepresentable_schema_combination");
    expect(result.diagnostics?.map((diagnostic) => String(diagnostic.location?.pointer))).toContain(
      "/pattern",
    );
  });

  test("does not resolve partial array-index tokens in JSON Pointers", async () => {
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
