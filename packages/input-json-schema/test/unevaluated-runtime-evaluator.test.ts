import assert from "node:assert/strict";
import { test } from "node:test";

import type { JsonSchemaValue } from "../src";
import { jsonSchemaInputPluginOptionsSchema } from "../src";
import type { ResolvedJsonSchemaInputPluginOptions } from "../src/options";
import { createJsonSchemaReferenceResolver } from "../src/reference";
import type { JsonSchemaResourceLocation } from "../src/resource-graph";
import { createRuntimeDescriptorValidator } from "../src/unevaluated-runtime";
import { buildRuntimeDescriptors } from "../src/unevaluated-runtime-descriptors";

const draft7SchemaUri = "http://json-schema.org/draft-07/schema#";
const draft2020SchemaUri = "https://json-schema.org/draft/2020-12/schema";
const rootRetrievalUri = "https://example.test/mixed-dialect/root";
const draft7RetrievalUri = "https://example.test/mixed-dialect/tuple";

void test("evaluates each resource with its declared dialect", () => {
  const rootSchema = {
    $ref: draft7RetrievalUri,
    $schema: draft2020SchemaUri,
    prefixItems: [{ type: "string" }],
  } satisfies JsonSchemaValue;
  const draft7Schema = {
    $id: draft7RetrievalUri,
    $schema: draft7SchemaUri,
    additionalItems: false,
    items: [true],
    type: "array",
  } satisfies JsonSchemaValue;
  const parsedOptions = jsonSchemaInputPluginOptionsSchema.parse({
    externalSchemas: { [draft7RetrievalUri]: draft7Schema },
    validator: "none",
  });
  const options: ResolvedJsonSchemaInputPluginOptions = {
    ...parsedOptions,
    dialect: "draft-2020-12",
  };
  const references = createJsonSchemaReferenceResolver(
    { schema: rootSchema, source: { kind: "uri", uri: rootRetrievalUri } },
    options,
  );
  assert.equal(references.ok, true);
  const dialectForLocation = (location: JsonSchemaResourceLocation): "draft-2020-12" | "draft-7" =>
    location.retrievalUri === draft7RetrievalUri ? "draft-7" : "draft-2020-12";
  const graph = buildRuntimeDescriptors({
    dialect: "draft-2020-12",
    dialectForLocation,
    reachableLocations: new Set(references.value.graph.reachableLocations),
    references: references.value,
    schemaForLocation: (location) => location.schema,
  });
  const validator = createRuntimeDescriptorValidator(graph, dialectForLocation);
  assert.equal(validator.ok, true);

  assert.equal(validator.value(["accepted"]), true);
  assert.equal(validator.value([1]), false, "the Draft 2020-12 prefixItems schema must apply");
  assert.equal(
    validator.value(["accepted", "extra"]),
    false,
    "the Draft 7 additionalItems schema must apply",
  );
});
