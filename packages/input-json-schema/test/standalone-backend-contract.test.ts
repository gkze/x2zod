import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SyntaxKind } from "@typescript/native-preview/unstable/ast";

import type { JsonSchemaDialect, JsonSchemaValue } from "../src";
import { analyzeAjvStandaloneSource, scanAjvStandaloneTokens } from "../src/ajv-standalone-source";
import {
  compileGeneratedSchema,
  verifyGeneratedSchemaRuntimeIsolation,
} from "./generated-schema-harness";

const recursiveProperties = {
  labels: { items: { minLength: 1, type: "string" }, type: "array", uniqueItems: true },
  name: { maxLength: 1, minLength: 1, type: "string" },
  records: { items: { type: "object" }, type: "array", uniqueItems: true },
} as const;
const commonRecursiveSchema = {
  additionalProperties: false,
  patternProperties: { "^x": false },
  required: ["labels", "name", "records"],
  type: "object",
} as const;
const cases: readonly Readonly<{ dialect: JsonSchemaDialect; schema: JsonSchemaValue }>[] = [
  {
    dialect: "draft-7",
    schema: {
      definitions: {
        node: {
          ...commonRecursiveSchema,
          properties: { ...recursiveProperties, next: { $ref: "#/definitions/node" } },
        },
      },
      $ref: "#/definitions/node",
    },
  },
  {
    dialect: "draft-2019-09",
    schema: {
      ...commonRecursiveSchema,
      $recursiveAnchor: true,
      properties: { ...recursiveProperties, next: { $recursiveRef: "#" } },
    },
  },
  {
    dialect: "draft-2020-12",
    schema: {
      ...commonRecursiveSchema,
      $dynamicAnchor: "node",
      properties: { ...recursiveProperties, next: { $dynamicRef: "#node" } },
    },
  },
];
const acceptedValue = {
  labels: ["one", "two"],
  name: "😀",
  next: { labels: [], name: "🪐", records: [] },
  records: [{ id: 1 }, { id: 2 }],
};
const rejectedValues = [
  { labels: [], name: "a", records: [{ id: 1 }, { id: 1 }] },
  {
    labels: [],
    name: "a",
    next: { labels: [], name: "b", records: [{ id: 1 }, { id: 1 }] },
    records: [],
  },
  { labels: [], name: "😀a", records: [] },
] as const;

const moduleImportSpecifiers = (source: string): readonly string[] => {
  const tokens = scanAjvStandaloneTokens(source);
  return tokens.flatMap((token, index) => {
    if (token.kind !== SyntaxKind.StringLiteral) return [];
    const previous = tokens[index - 1];
    const beforePrevious = tokens[index - 2];
    return previous?.kind === SyntaxKind.ImportKeyword ||
      previous?.kind === SyntaxKind.FromKeyword ||
      (beforePrevious?.kind === SyntaxKind.ImportKeyword &&
        previous?.kind === SyntaxKind.OpenParenToken)
      ? [token.value]
      : [];
  });
};

void describe("generated exact backend contract", () => {
  for (const { dialect, schema } of cases)
    void test(`${dialect} is deterministic, self-contained, and executable`, async () => {
      const [first, second] = await Promise.all([
        compileGeneratedSchema(schema, { dialect }),
        compileGeneratedSchema(schema, { dialect }),
      ]);

      assert.equal(first.source, second.source);
      assert.deepEqual(moduleImportSpecifiers(first.source), ["zod/v4"]);
      assert.deepEqual(analyzeAjvStandaloneSource(first.source).runtimeDependencies, [
        "ajv/dist/runtime/equal",
        "ajv/dist/runtime/ucs2length",
      ]);
      assert.match(first.source, /x2zodRuntimeProgram/u);
      assert.deepEqual(first.generatedSchema.safeParse(acceptedValue), {
        data: acceptedValue,
        success: true,
      });
      for (const value of rejectedValues)
        assert.equal(first.generatedSchema.safeParse(value).success, false);
      await verifyGeneratedSchemaRuntimeIsolation({
        acceptedValues: [acceptedValue],
        rejectedValues,
        source: first.source,
      });
    });
});
