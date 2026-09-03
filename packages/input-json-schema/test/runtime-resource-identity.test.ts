import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../src";
import type { ResolvedJsonSchemaInputPluginOptions } from "../src/options";
import { createJsonSchemaReferenceResolver } from "../src/reference";
import { createRuntimeDescriptorValidator } from "../src/unevaluated-runtime";
import { buildRuntimeDescriptors } from "../src/unevaluated-runtime-descriptors";
import type { RuntimeNodeValidator } from "../src/unevaluated-runtime-evaluator";

const rootRetrievalUri = "https://example.test/runtime-identity/root";
const firstRetrievalUri = "https://example.test/runtime-identity/first";
const secondRetrievalUri = "https://example.test/runtime-identity/second";
const sharedIdentifier = "urn:example:shared-runtime-identity";

type RuntimeIdentityScenario = Readonly<{
  anchor: "$dynamicAnchor" | "$recursiveAnchor";
  dialect: Extract<JsonSchemaDialect, "draft-2019-09" | "draft-2020-12">;
  schemaUri: string;
}>;

const scenarios = [
  {
    anchor: "$dynamicAnchor",
    dialect: "draft-2020-12",
    schemaUri: "https://json-schema.org/draft/2020-12/schema",
  },
  {
    anchor: "$recursiveAnchor",
    dialect: "draft-2019-09",
    schemaUri: "https://json-schema.org/draft/2019-09/schema",
  },
] as const satisfies readonly RuntimeIdentityScenario[];

const anchoredResource = (scenario: RuntimeIdentityScenario, flavor: string): JsonSchemaValue => {
  const child =
    scenario.anchor === "$dynamicAnchor" ? { $dynamicRef: "#node" } : { $recursiveRef: "#" };
  return {
    $id: sharedIdentifier,
    $schema: scenario.schemaUri,
    ...(scenario.anchor === "$dynamicAnchor"
      ? { $dynamicAnchor: "node" }
      : { $recursiveAnchor: true }),
    properties: { child, flavor: { const: flavor } },
    required: ["flavor"],
    type: "object",
  };
};

const runtimeValidator = (
  scenario: RuntimeIdentityScenario,
  schema: JsonSchemaValue,
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
): RuntimeNodeValidator => {
  const parsedOptions = jsonSchemaInputPluginOptionsSchema.parse({
    dialect: scenario.dialect,
    externalSchemas,
    validator: "none",
  });
  const options: ResolvedJsonSchemaInputPluginOptions = {
    ...parsedOptions,
    dialect: scenario.dialect,
  };
  const references = createJsonSchemaReferenceResolver(
    { schema, source: { kind: "uri", uri: rootRetrievalUri } },
    options,
  );
  if (!references.ok) throw new Error("Expected a valid reference graph.");
  const dialectForLocation = (): JsonSchemaDialect => scenario.dialect;
  const graph = buildRuntimeDescriptors({
    dialect: scenario.dialect,
    dialectForLocation,
    reachableLocations: new Set(references.value.graph.reachableLocations),
    references: references.value,
    schemaForLocation: (location) => location.schema,
  });
  const validator = createRuntimeDescriptorValidator(graph, dialectForLocation);
  if (!validator.ok) throw new Error("Expected a valid runtime descriptor graph.");
  return validator.value;
};

for (const scenario of scenarios)
  void test(`keeps duplicate-$id ${scenario.anchor} scopes separate by retrieval identity`, () => {
    const validate = runtimeValidator(
      scenario,
      {
        $schema: scenario.schemaUri,
        properties: { first: { $ref: firstRetrievalUri }, second: { $ref: secondRetrievalUri } },
        required: ["first", "second"],
        type: "object",
      },
      {
        [firstRetrievalUri]: anchoredResource(scenario, "first"),
        [secondRetrievalUri]: anchoredResource(scenario, "second"),
      },
    );
    const valid = {
      first: { child: { flavor: "first" }, flavor: "first" },
      second: { child: { flavor: "second" }, flavor: "second" },
    };

    assert.equal(validate(valid), true);
    assert.equal(
      validate({ ...valid, second: { child: { flavor: "first" }, flavor: "second" } }),
      false,
    );
  });

void test("compiles exact-selected duplicate identifiers through the graph runtime", async () => {
  const result = await compileToZodSource({
    document: {
      source: { kind: "uri", uri: rootRetrievalUri },
      text: JSON.stringify({ allOf: [{ $ref: firstRetrievalUri }, { $ref: secondRetrievalUri }] }),
    },
    output: { typeName: "DuplicateIdentifierRuntime" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: {
        [firstRetrievalUri]: { $id: sharedIdentifier, minProperties: 1, type: "object" },
        [secondRetrievalUri]: { $id: sharedIdentifier, maxProperties: 1, type: "object" },
      },
      validator: "none",
    },
  });

  assert.equal(result.ok, true);
});
