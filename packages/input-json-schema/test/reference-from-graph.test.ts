import assert from "node:assert/strict";
import { test } from "node:test";

import { createJsonSchemaReferenceResolverFromGraph } from "../src/reference";
import { buildJsonSchemaResourceGraph, jsonSchemaLocationId } from "../src/resource-graph";

void test("roots a reference resolver at a requested graph location", () => {
  const externalUri = "https://registry.example.test/external.json";
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: { [externalUri]: { $defs: { child: { type: "string" } } } },
    rootRetrievalUri: "https://retrieval.example.test/root.json",
    schema: true,
  });
  assert.equal(result.ok, true);
  const externalRoot = jsonSchemaLocationId(externalUri, "");
  const references = createJsonSchemaReferenceResolverFromGraph(result.value, externalRoot);

  assert.equal(references.root.location, externalRoot);
  assert.equal(references.root.address, "");
  assert.equal(references.resolve("#/$defs/child", externalRoot)?.address, "/$defs/child");
});

void test("keeps local fragments scoped to their source resource", () => {
  const rootRetrievalUri = "https://retrieval.example.test/root.json";
  const sharedId = "urn:example:shared";
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      "https://registry.example.test/unused.json": {
        $anchor: "named",
        $defs: { invalid: { $id: "http://[" } },
        $id: sharedId,
        type: "number",
      },
    },
    rootRetrievalUri,
    schema: {
      $defs: { local: { $anchor: "named", type: "string" } },
      $id: sharedId,
      properties: { child: { $ref: "" } },
    },
  });
  assert.equal(result.ok, true);
  const references = createJsonSchemaReferenceResolverFromGraph(result.value, result.value.root);

  assert.equal(
    references.resolve("#", references.root.location)?.location,
    references.root.location,
  );
  assert.equal(references.resolve("#named", references.root.location)?.pointer, "/$defs/local");
  const child = jsonSchemaLocationId(rootRetrievalUri, "/properties/child");
  assert.equal(references.resolve("", child)?.location, references.root.location);
});

void test("materializes a local pointer inside its source document", () => {
  const firstUri = "https://registry.example.test/a.json";
  const secondUri = "https://registry.example.test/z.json";
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      [firstUri]: { $id: "urn:example:shared", examples: [{ type: "number" }] },
      [secondUri]: {
        $id: "urn:example:shared",
        $ref: "#/examples/0",
        examples: [{ type: "string" }],
      },
    },
    schema: { $ref: secondUri },
  });
  assert.equal(result.ok, true);
  const firstTarget = jsonSchemaLocationId(firstUri, "/examples/0");
  const secondTarget = jsonSchemaLocationId(secondUri, "/examples/0");

  assert.equal(result.value.location(firstTarget), undefined);
  assert.deepEqual(result.value.location(secondTarget)?.schema, { type: "string" });
  assert.ok(result.value.reachableLocations.includes(secondTarget));
});
