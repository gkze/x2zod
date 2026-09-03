import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import { buildJsonSchemaResourceGraph } from "../src/resource-graph";

const rootRetrievalUri = "https://retrieval.example.test/schemas/root.json";

void test("rejects malformed URI-reference identifiers at the root", () => {
  for (const identifier of ["http://[", "urn:%ZZ", "%ZZ", "https://example.test/%ZZ"]) {
    const result = buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      rootRetrievalUri,
      schema: { $id: identifier },
    });

    assert.equal(result.ok, false, identifier);
    assert.equal(result.diagnostics[0].code, "invalid_schema_document", identifier);
    assert.equal(result.diagnostics[0].location?.pointer, "", identifier);
  }
});

void test("rejects malformed identifiers throughout a selected external document", () => {
  const externalRetrievalUri = "https://registry.example.test/selected.json";
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      [externalRetrievalUri]: {
        $defs: { malformed: { $id: "https://example.test/%ZZ" } },
        type: "object",
      },
    },
    rootRetrievalUri,
    schema: { $ref: externalRetrievalUri },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
  assert.equal(result.diagnostics[0].location?.pointer, "/$defs/malformed");
});

void test("quarantines malformed identifiers in wholly unused external documents", () => {
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      "https://registry.example.test/unused.json": { $defs: { malformed: { $id: "http://[" } } },
    },
    rootRetrievalUri,
    schema: true,
  });

  assert.equal(result.ok, true);
});

void test("rejects non-empty modern identifier fragments while retaining Draft 7 fragments", () => {
  for (const identifier of ["relative#named", "https://example.test/schema#named"]) {
    const result = buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      rootRetrievalUri,
      schema: { $id: identifier },
    });

    assert.equal(result.ok, false, identifier);
  }

  const draft7 = buildJsonSchemaResourceGraph({
    dialect: "draft-7",
    rootRetrievalUri,
    schema: { definitions: { target: { $id: "#named" } }, $ref: "#named" },
  });
  assert.equal(draft7.ok, true);
});

void test("normalizes empty root and embedded identifier fragments in modern dialects", () => {
  for (const dialect of ["draft-2019-09", "draft-2020-12"] as const) {
    const root = buildJsonSchemaResourceGraph({ dialect, rootRetrievalUri, schema: { $id: "#" } });
    assert.equal(root.ok, true, dialect);
    assert.equal(root.value.location(root.value.root)?.resourceUri, rootRetrievalUri, dialect);

    const childUri = "https://canonical.example.test/child";
    const embedded = buildJsonSchemaResourceGraph({
      dialect,
      rootRetrievalUri,
      schema: { $defs: { child: { $id: `${childUri}#` } }, $ref: childUri },
    });
    assert.equal(embedded.ok, true, dialect);
    assert.equal(
      embedded.value.resolve({ from: embedded.value.root, reference: childUri })?.location
        .resourceUri,
      childUri,
      dialect,
    );
  }
});

void test("rejects malformed or relative root retrieval URIs", () => {
  for (const uri of ["http://[", "root.json", "https://example.test/%ZZ"]) {
    const result = buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      rootRetrievalUri: uri,
      schema: true,
    });

    assert.equal(result.ok, false, uri);
    assert.equal(result.diagnostics[0].code, "invalid_schema_document", uri);
  }
});

void test("rejects malformed or relative external registry keys", () => {
  for (const uri of ["http://[", "child.json", "https://example.test/%ZZ"]) {
    const result = buildJsonSchemaResourceGraph({
      dialect: "draft-2020-12",
      externalSchemas: { [uri]: true },
      rootRetrievalUri,
      schema: true,
    });

    assert.equal(result.ok, false, uri);
    assert.equal(result.diagnostics[0].code, "invalid_schema_document", uri);
  }
});

void test("rejects a malformed URI document source", async () => {
  const uri = "https://retrieval.example.test/%ZZ";
  const result = await compileToZodSource({
    document: { source: { kind: "uri", uri }, text: JSON.stringify({ type: "string" }) },
    output: { typeName: "MalformedRetrievedReference" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: { validator: "none" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
});
