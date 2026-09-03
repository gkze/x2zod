import assert from "node:assert/strict";
import { test } from "node:test";

import type { JsonSchemaValue } from "../src";
import { buildJsonSchemaResourceGraph, jsonSchemaLocationId } from "../src/resource-graph";
import type { JsonSchemaResourceGraph } from "../src/resource-graph";

const rootRetrievalUri = "https://retrieval.example.test/schemas/root.json";

const buildGraph = (
  schema: JsonSchemaValue,
  dialect: "draft-2019-09" | "draft-2020-12" | "draft-7" = "draft-2020-12",
  externalSchemas: Readonly<Record<string, JsonSchemaValue>> = {},
): JsonSchemaResourceGraph => {
  const result = buildJsonSchemaResourceGraph({
    dialect,
    externalSchemas,
    rootRetrievalUri,
    schema,
  });
  assert.equal(result.ok, true);
  return result.value;
};

void test("resolves embedded resources against the nearest effective base URI", () => {
  const graph = buildGraph({
    $defs: {
      child: {
        $anchor: "childAnchor",
        $defs: { leaf: { type: "string" } },
        $id: "../child/",
        properties: { nested: { $id: "nested/", type: "object" } },
      },
    },
    $id: "https://canonical.example.test/base/root.json",
  });
  const childId = jsonSchemaLocationId(rootRetrievalUri, "/$defs/child");
  const nestedId = jsonSchemaLocationId(rootRetrievalUri, "/$defs/child/properties/nested");

  assert.equal(graph.location(childId)?.baseUri, "https://canonical.example.test/child/");
  assert.equal(graph.location(nestedId)?.baseUri, "https://canonical.example.test/child/nested/");
  assert.equal(
    graph.resolve({ from: graph.root, reference: "../child/#childAnchor" })?.location.id,
    childId,
  );
  assert.equal(
    graph.resolve({ from: childId, reference: "#/$defs/leaf" })?.location.pointer,
    "/$defs/child/$defs/leaf",
  );
});

void test("indexes retrieval and canonical identifiers for external resources", () => {
  const externalRetrievalUri = "https://registry.example.test/retrieved.json";
  const externalCanonicalUri = "urn:example:canonical-schema";
  const graph = buildGraph({ type: "object" }, "draft-2020-12", {
    [externalRetrievalUri]: {
      $anchor: "record",
      $id: externalCanonicalUri,
      properties: { id: { type: "string" } },
    },
  });

  const byRetrieval = graph.resolve({ from: graph.root, reference: externalRetrievalUri });
  const byCanonical = graph.resolve({
    from: graph.root,
    reference: `${externalCanonicalUri}#record`,
  });

  if (byRetrieval === undefined || byCanonical === undefined)
    assert.fail("expected retrieval and canonical identifiers to resolve");
  assert.equal(byRetrieval.location.id, byCanonical.location.id);
  assert.equal(byCanonical.location.retrievalUri, externalRetrievalUri);
  assert.equal(byCanonical.location.resourceUri, externalCanonicalUri);
});

void test("resolves percent-encoded and escaped JSON Pointer fragments", () => {
  const graph = buildGraph({ $defs: { "a/b": { type: "string" }, "t~n": { type: "number" } } });

  assert.equal(
    graph.resolve({ from: graph.root, reference: "#/%24defs/a~1b" })?.location.pointer,
    "/$defs/a~1b",
  );
  assert.equal(
    graph.resolve({ from: graph.root, reference: "#/$defs/t~0n" })?.location.pointer,
    "/$defs/t~0n",
  );
});

void test("supports absolute URN resources and pointer references", () => {
  const targetUrn = "urn:uuid:deadbeef-4321-ffff-ffff-1234feebdaed";
  const graph = buildGraph({
    $defs: { target: { $defs: { value: { type: "string" } }, $id: targetUrn } },
    $id: "urn:uuid:root-resource",
  });

  assert.equal(
    graph.resolve({ from: graph.root, reference: `${targetUrn}#/$defs/value` })?.location.pointer,
    "/$defs/target/$defs/value",
  );
});

void test("walks dialect-specific tuple and prefix-item subschemas", () => {
  const schema = {
    items: [{ $id: "tuple-item", type: "string" }],
    prefixItems: [{ $id: "prefix-item", type: "number" }],
  } as const;
  const draft2019 = buildGraph(schema, "draft-2019-09");
  const draft2020 = buildGraph(schema, "draft-2020-12");

  assert.equal(
    draft2019.resolve({ from: draft2019.root, reference: "tuple-item" })?.location.pointer,
    "/items/0",
  );
  assert.equal(draft2019.resolve({ from: draft2019.root, reference: "prefix-item" }), undefined);
  assert.equal(
    draft2020.resolve({ from: draft2020.root, reference: "prefix-item" })?.location.pointer,
    "/prefixItems/0",
  );
  assert.equal(draft2020.resolve({ from: draft2020.root, reference: "tuple-item" }), undefined);
});

void test("indexes named anchors only in dialects that define them", () => {
  const draft7 = buildGraph(
    { definitions: { target: { $anchor: "named", type: "string" } } },
    "draft-7",
  );
  const draft2019 = buildGraph(
    { $defs: { target: { $anchor: "named", type: "string" } } },
    "draft-2019-09",
  );

  assert.equal(draft7.resolve({ from: draft7.root, reference: "#named" }), undefined);
  assert.equal(
    draft2019.resolve({ from: draft2019.root, reference: "#named" })?.location.pointer,
    "/$defs/target",
  );
});

void test("discovers an embedded custom metaschema before walking dialect-specific children", () => {
  const graph = buildGraph({
    $defs: {
      meta: {
        $id: "urn:example:embedded-meta-7",
        $schema: "http://json-schema.org/draft-07/schema#",
      },
      model: {
        $id: "urn:example:model-7",
        $schema: "urn:example:embedded-meta-7",
        additionalItems: false,
        items: [{ type: "string" }],
        type: "array",
      },
    },
    $ref: "urn:example:model-7",
    $schema: "https://json-schema.org/draft/2020-12/schema",
  });
  const model = jsonSchemaLocationId(rootRetrievalUri, "/$defs/model");

  assert.deepEqual(
    graph.children(model).map(({ pointer }) => pointer),
    ["/$defs/model/additionalItems", "/$defs/model/items/0"],
  );
});

void test("indexes dynamic anchors only in Draft 2020-12", () => {
  const schema = {
    $defs: { target: { $dynamicAnchor: "named", type: "string" } },
    $ref: "#named",
  } as const;
  const draft2019 = buildGraph(schema, "draft-2019-09");
  const draft2020 = buildGraph(schema, "draft-2020-12");

  assert.equal(draft2019.resolve({ from: draft2019.root, reference: "#named" }), undefined);
  assert.equal(
    draft2020.resolve({ from: draft2020.root, reference: "#named" })?.location.pointer,
    "/$defs/target",
  );
});

void test("does not index cross-draft declaration containers", () => {
  const draft7 = buildGraph({ $defs: { target: { $id: "urn:example:dollar" } } }, "draft-7");
  const draft2020 = buildGraph(
    { definitions: { target: { $id: "urn:example:legacy" } } },
    "draft-2020-12",
  );

  assert.equal(draft7.resolve({ from: draft7.root, reference: "urn:example:dollar" }), undefined);
  assert.equal(
    draft2020.resolve({ from: draft2020.root, reference: "urn:example:legacy" }),
    undefined,
  );
});

void test("resolves explicitly referenced wrong-dialect declaration data without indexing peers", () => {
  const draft7 = buildGraph(
    {
      $defs: {
        peer: { $id: "urn:example:unreferenced" },
        target: { $id: "urn:example:referenced", type: "string" },
      },
      $ref: "#/$defs/target",
    },
    "draft-7",
  );
  const draft2019 = buildGraph(
    { definitions: { target: { type: "number" } }, $ref: "#/definitions/target" },
    "draft-2019-09",
  );

  assert.equal(
    draft7.resolve({ from: draft7.root, reference: "#/$defs/target" })?.location.pointer,
    "/$defs/target",
  );
  assert.equal(
    draft2019.resolve({ from: draft2019.root, reference: "#/definitions/target" })?.location
      .pointer,
    "/definitions/target",
  );
  assert.equal(
    draft7.resolve({ from: draft7.root, reference: "urn:example:unreferenced" }),
    undefined,
  );
});

void test("keeps Draft 7 ref siblings indexed but not semantically applied", () => {
  const graph = buildGraph(
    { $ref: "#foo", definitions: { target: { $id: "#foo", type: "string" } } },
    "draft-7",
  );

  assert.equal(
    graph.resolve({ from: graph.root, reference: "#foo" })?.location.pointer,
    "/definitions/target",
  );
  assert.deepEqual(graph.reachableLocations, [
    graph.root,
    jsonSchemaLocationId(rootRetrievalUri, "/definitions/target"),
  ]);
});

void test("materializes an explicitly referenced object through arbitrary data", () => {
  const graph = buildGraph({ examples: [{ type: "string" }], $ref: "#/examples/0" });
  const targetId = jsonSchemaLocationId(rootRetrievalUri, "/examples/0");

  assert.equal(
    graph.resolve({ from: graph.root, reference: "#/examples/0" })?.location.id,
    targetId,
  );
  assert.ok(graph.locations.some(({ id }) => id === targetId));
});

void test("keeps resource bases while materializing through arbitrary data", () => {
  const graph = buildGraph({
    $defs: {
      outer: { $id: "nested/", examples: [{ $ref: "value.json" }] },
      value: { $id: "value.json", const: "root" },
    },
    $id: rootRetrievalUri,
    $ref: "#/$defs/outer/examples/0",
  });
  const target = graph.resolve({ from: graph.root, reference: "#/$defs/outer/examples/0" });

  assert.ok(target);
  assert.equal(target.location.baseUri, "https://retrieval.example.test/schemas/nested/");
  assert.equal(target.location.pointer, "/$defs/outer/examples/0");
});

void test("indexes dynamic anchors as plain-name reference targets", () => {
  const graph = buildGraph({ $defs: { target: { $dynamicAnchor: "named", type: "string" } } });

  assert.equal(
    graph.resolve({ from: graph.root, reference: "#named" })?.location.pointer,
    "/$defs/target",
  );
});

void test("reports referenced duplicate resource identifiers deterministically", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      "https://registry.example.test/z.json": { $id: "urn:example:duplicate" },
      "https://registry.example.test/a.json": { $id: "urn:example:duplicate" },
    },
    rootRetrievalUri,
    schema: { $ref: "urn:example:duplicate" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(
    result.diagnostics[0].message,
    "JSON Schema resource identifier is not unique: urn:example:duplicate.",
  );
});

void test("rejects unreferenced duplicate identifiers inside the root document", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    rootRetrievalUri,
    schema: { $defs: { first: { $id: "dup" }, second: { $id: "dup" } } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(
    result.diagnostics[0].message,
    "JSON Schema resource identifier is not unique: https://retrieval.example.test/schemas/dup.",
  );
});

void test("rejects an unreferenced malformed identifier inside the root document", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    rootRetrievalUri,
    schema: { $defs: { unused: { $id: "#%ZZ" } } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(result.diagnostics[0].location?.pointer, "/$defs/unused");
});

void test("ignores duplicate identifiers in unreachable external resources", () => {
  const build = (
    externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  ): ReturnType<typeof buildJsonSchemaResourceGraph> =>
    buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      externalSchemas,
      rootRetrievalUri,
      schema: true,
    });
  const forward = build({
    "https://registry.example.test/a.json": { $id: "urn:example:duplicate" },
    "https://registry.example.test/z.json": { $id: "urn:example:duplicate" },
  });
  const reverse = build({
    "https://registry.example.test/z.json": { $id: "urn:example:duplicate" },
    "https://registry.example.test/a.json": { $id: "urn:example:duplicate" },
  });

  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
});

void test("rejects normalized retrieval URI collisions deterministically", () => {
  const build = (
    externalSchemas: Readonly<Record<string, JsonSchemaValue>>,
  ): ReturnType<typeof buildJsonSchemaResourceGraph> =>
    buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      externalSchemas,
      rootRetrievalUri,
      schema: { $ref: "https://registry.example.test/model.json" },
    });
  const forward = build({
    "https://registry.example.test/model.json": { type: "number" },
    "https://registry.example.test/model.json#": { type: "string" },
  });
  const reverse = build({
    "https://registry.example.test/model.json#": { type: "string" },
    "https://registry.example.test/model.json": { type: "number" },
  });

  assert.equal(forward.ok, false);
  assert.equal(reverse.ok, false);
  assert.equal(forward.diagnostics[0].message, reverse.diagnostics[0].message);
  assert.equal(
    forward.diagnostics[0].message,
    "External schema registry keys are not unique after normalization: https://registry.example.test/model.json.",
  );
});

void test("rejects an external retrieval URI colliding with the root document", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: { [`${rootRetrievalUri}#`]: { type: "string" } },
    rootRetrievalUri,
    schema: { type: "number" },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics[0].message,
    `JSON Schema retrieval URI is not unique after normalization: ${rootRetrievalUri}.`,
  );
});

void test("normalizes a trailing fragment on the root retrieval URI", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    rootRetrievalUri: `${rootRetrievalUri}#`,
    schema: { $defs: { target: { type: "string" } }, $ref: "#/$defs/target" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.location(result.value.root)?.retrievalUri, rootRetrievalUri);
  assert.equal(
    result.value.resolve({ from: result.value.root, reference: "#/$defs/target" })?.location
      .pointer,
    "/$defs/target",
  );
});

void test("rejects a non-empty fragment on the root retrieval URI", () => {
  const uri = `${rootRetrievalUri}#target`;
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    rootRetrievalUri: uri,
    schema: { type: "string" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(
    result.diagnostics[0].message,
    `JSON Schema root retrieval URI must be a fragmentless retrieval URI: ${uri}.`,
  );
});

void test("rejects a normalized root retrieval URI colliding with an external entry", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: { [rootRetrievalUri]: { type: "string" } },
    rootRetrievalUri: `${rootRetrievalUri}#`,
    schema: { type: "number" },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics[0].message,
    `JSON Schema retrieval URI is not unique after normalization: ${rootRetrievalUri}.`,
  );
});

void test("ignores identifiers in Draft 7 ref siblings", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-7",
    externalSchemas: {
      "https://registry.example.test/model.json": {
        definitions: { nested: { $id: "urn:example:collision" } },
        type: "number",
      },
    },
    rootRetrievalUri,
    schema: {
      $ref: "https://registry.example.test/model.json",
      definitions: { ignored: { $id: "urn:example:collision" } },
    },
  });

  assert.equal(result.ok, true);
});

void test("is deterministic across external registry insertion order", () => {
  const firstUri = "https://registry.example.test/a.json";
  const secondUri = "https://registry.example.test/b.json";
  const firstSchema = { $id: "urn:example:a", type: "string" } as const;
  const secondSchema = { $id: "urn:example:b", type: "number" } as const;
  const forward = buildGraph(true, "draft-2020-12", {
    [firstUri]: firstSchema,
    [secondUri]: secondSchema,
  });
  const reverse = buildGraph(true, "draft-2020-12", {
    [secondUri]: secondSchema,
    [firstUri]: firstSchema,
  });

  assert.deepEqual(forward.locations, reverse.locations);
  assert.deepEqual(forward.resources, reverse.resources);
});

void test("exposes deterministic direct schema children for reachability scans", () => {
  const graph = buildGraph({
    allOf: [{ type: "string" }],
    properties: { zed: { type: "number" }, alpha: { type: "boolean" } },
  });

  assert.deepEqual(
    graph.children(graph.root).map((location) => location.pointer),
    ["/allOf/0", "/properties/alpha", "/properties/zed"],
  );
});
