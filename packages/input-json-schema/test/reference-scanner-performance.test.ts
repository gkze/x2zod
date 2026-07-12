import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import type { JsonObject, JsonSchemaValue } from "../src";

const externalSchemaUri = "https://example.test/reference-dag.json";
const referenceDagDepth = 12;
const maximumDefinitionReadsPerLevel = 64;

type ReferenceDagLeafType = "array" | "object" | "string";

const referenceTo = (name: string): JsonObject => ({ $ref: `${externalSchemaUri}#/$defs/${name}` });

const addReferenceDag = (
  definitions: Record<string, JsonSchemaValue>,
  prefix: string,
  leafType: ReferenceDagLeafType,
): void => {
  for (let depth = referenceDagDepth; depth >= 0; depth -= 1) {
    const name = `${prefix}${depth}`;
    definitions[name] =
      depth === referenceDagDepth
        ? { type: leafType }
        : { anyOf: [referenceTo(`${prefix}${depth + 1}`), referenceTo(`${prefix}${depth + 1}`)] };
  }
};

const trackedExternalSchema = (): Readonly<{
  definitionReads: () => number;
  schema: JsonObject;
}> => {
  let definitionReads = 0;
  const definitions: Record<string, JsonSchemaValue> = {};
  addReferenceDag(definitions, "boundary", "string");
  addReferenceDag(definitions, "object", "object");
  addReferenceDag(definitions, "array", "array");

  const trackedDefinitions = new Proxy(definitions, {
    get: (target, property, receiver): unknown => {
      if (typeof property === "string" && Object.hasOwn(target, property)) definitionReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  return { definitionReads: () => definitionReads, schema: { $defs: trackedDefinitions } };
};

void test("compiles shared external reference DAGs with linear resolution work", async () => {
  const external = trackedExternalSchema();
  const result = await compileToZodSource({
    document: {
      source: { id: "shared-reference-dags", kind: "inline" },
      text: JSON.stringify({
        anyOf: [
          { allOf: [referenceTo("boundary0"), { type: "string" }] },
          { ...referenceTo("object0"), properties: { value: { type: "string" } } },
          { ...referenceTo("array0"), items: { type: "string" } },
        ],
      }),
    },
    output: { typeName: "SharedReferenceDags" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { externalSchemas: { [externalSchemaUri]: external.schema }, validator: "none" },
  });

  if (!result.ok)
    assert.fail(
      `Expected the shared reference DAGs to compile: ${result.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`,
    );

  const maximumDefinitionReads = referenceDagDepth * maximumDefinitionReadsPerLevel;
  assert.ok(
    external.definitionReads() <= maximumDefinitionReads,
    [
      `Expected at most ${String(maximumDefinitionReads)} definition reads`,
      `for depth ${String(referenceDagDepth)}, observed ${String(external.definitionReads())}.`,
    ].join(" "),
  );
});
