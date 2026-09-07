import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import nodePath from "node:path";
import { test } from "node:test";

import { createTemporaryDirectory } from "../../../test/native-source-harness";
import type { JsonSchemaInputPluginOptionsInput, JsonSchemaValue } from "../src";
import { jsonSchemaValueSchema } from "../src";
import { jsonSchemaKeywords } from "../src/metadata";
import { generateSchemaFixture } from "./schema-fixture-harness";
import { customMetaschema } from "./vocabulary-test-support";

const cases: readonly Readonly<{
  name: string;
  schema: JsonSchemaValue;
  options?: JsonSchemaInputPluginOptionsInput;
  accepted: readonly unknown[];
  rejected: readonly unknown[];
}>[] = [
  {
    name: "nested propertyNames preserves fields and does not require enumerated keys",
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        labels: {
          type: "object",
          propertyNames: { enum: ["first", "second"] },
          additionalProperties: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    accepted: [
      { name: "ok" },
      { name: "ok", labels: {} },
      { name: "ok", labels: { first: "one" } },
    ],
    rejected: [
      { name: 1 },
      { name: "ok", labels: { other: "bad" } },
      { name: "ok", labels: { first: 1 } },
    ],
  },
  {
    name: "local negation fallback retains parent and referenced field types",
    schema: {
      type: "object",
      required: ["name"],
      properties: { name: { $ref: "#/$defs/name" } },
      $defs: { name: { type: "string", not: { const: "blocked" } } },
    },
    accepted: [{ name: "ok" }],
    rejected: [{ name: "blocked" }, { name: 1 }, {}],
  },
  {
    name: "closed allOf boundaries keep the structural intersection",
    schema: {
      allOf: [
        {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
        { type: "object", properties: { name: { minLength: 2 } } },
      ],
    },
    accepted: [{ name: "ok" }],
    rejected: [{ name: "x" }, { name: "ok", extra: true }, {}],
  },
  {
    name: "unmergeable evaluated-key boundaries retain sibling types",
    schema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
      allOf: [
        {
          if: { properties: { name: { const: "extra" } } },
          [jsonSchemaKeywords.thenKeyword]: { properties: { extra: { type: "number" } } },
        },
      ],
      unevaluatedProperties: false,
    },
    accepted: [{ name: "ok" }, { name: "extra", extra: 1 }],
    rejected: [{ name: "ok", extra: 1 }, { name: "extra", extra: "bad" }, { name: 1 }],
  },
  {
    name: "merged external references retain resource scope and Draft 7 sibling policy",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      definitions: { name: { type: "number" } },
      allOf: [{ $ref: "https://example.test/fields", properties: { name: { type: "number" } } }],
    },
    options: {
      externalSchemas: {
        "https://example.test/fields": {
          $schema: "http://json-schema.org/draft-07/schema#",
          $id: "https://example.test/fields",
          required: ["name"],
          properties: { name: { $ref: "#/definitions/name" } },
          definitions: { name: { type: "string", not: { const: "blocked" } } },
        },
      },
    },
    accepted: [{ name: "ok" }],
    rejected: [{ name: 1 }, { name: "blocked" }, {}],
  },
  {
    name: "merged allOf preserves additional own properties without a runtime predicate",
    schema: {
      type: "object",
      allOf: [{ properties: { name: { type: "string" } }, required: ["name"] }],
    },
    accepted: [{ name: "ok", extra: { nested: true } }, JSON.parse('{"name":"ok","__proto__":1}')],
    rejected: [{ name: 1 }, {}],
  },
  {
    name: "merged embedded resources resolve properties within their own base URI",
    schema: {
      $id: "https://example.test/root",
      type: "object",
      $defs: { name: { type: "number" } },
      allOf: [
        {
          $id: "fields",
          $defs: { name: { type: "string" } },
          properties: { name: { $ref: "#/$defs/name" } },
          required: ["name"],
        },
      ],
    },
    accepted: [{ name: "ok", extra: true }],
    rejected: [{ name: 1 }, {}],
  },
  {
    name: "object merging respects an external resource's omitted validation vocabulary",
    schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      allOf: [{ $ref: "https://example.test/annotation-fields" }],
    },
    options: {
      externalSchemas: {
        "https://example.test/no-validation": customMetaschema(
          "draft-2020-12",
          "https://example.test/no-validation",
          { core: true, applicator: true, unevaluated: true },
        ),
        "https://example.test/annotation-fields": {
          $id: "https://example.test/annotation-fields",
          $schema: "https://example.test/no-validation",
          type: "number",
          required: ["ignored"],
          properties: { name: { type: "number" } },
        },
      },
    },
    accepted: [{ name: "ok" }],
    rejected: [{ name: 1 }, {}],
  },
  {
    name: "merged declared prototype keys preserve validation and own-key presence",
    schema: jsonSchemaValueSchema.parse(
      JSON.parse(
        '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"],"allOf":[{"properties":{"__proto__":{"type":"string"}},"required":["__proto__","constructor"]}]}',
      ),
    ),
    accepted: [JSON.parse('{"name":"ok","__proto__":"value","constructor":1}')],
    rejected: [
      JSON.parse('{"name":"ok","__proto__":1,"constructor":1}'),
      JSON.parse('{"name":"ok","__proto__":"value"}'),
    ],
  },
  {
    name: "same-value reference cycles retain adjacent structural fields",
    schema: {
      $id: "https://example.test/typed-cycle",
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      $ref: "#/$defs/loop",
      $defs: { loop: { $ref: "https://example.test/typed-cycle" } },
      unevaluatedProperties: false,
    },
    accepted: [{ name: "ok" }],
    rejected: [{ name: 1 }, {}, { name: "ok", extra: true }],
  },
];

for (const fixture of cases)
  void test(fixture.name, async () => {
    const directory = createTemporaryDirectory({
      prefix: "runtime-inference-",
      rootDirectory: nodePath.join(import.meta.dirname, "../node_modules/.cache"),
    });
    try {
      const generated = await generateSchemaFixture(directory, fixture.schema, {
        pluginOptions: fixture.options,
        consumerSource: `
import type { Fixture } from "./generated";
type Assert<T extends true> = T;
export type NameIsString = Assert<Fixture["name"] extends string ? true : false>;
export type AcceptsString = Assert<string extends Fixture["name"] ? true : false>;
export type NotUnknown = Assert<unknown extends Fixture ? false : true>;
`,
      });
      for (const value of fixture.accepted) {
        const parsed = generated.safeParse(structuredClone(value));
        assert.equal(parsed.success, true, JSON.stringify(value));
        assert.deepEqual(parsed.data, value);
      }
      for (const value of fixture.rejected)
        assert.equal(generated.safeParse(value).success, false, JSON.stringify(value));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
