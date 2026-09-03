import assert from "node:assert/strict";
import { test } from "node:test";

import { compileToZodSource } from "@x2zod/core";

import { jsonSchemaInputPlugin } from "../src";
import { buildJsonSchemaResourceGraph } from "../src/resource-graph";
import { decodeJsonSchemaPlainNameFragment, resolveJsonSchemaUri } from "../src/retrieval-uri";
import { compileGeneratedSchema } from "./generated-schema-harness";

const baseUri = "https://base.example.test/a/b/c?old=1";
const rootRetrievalUri = "https://retrieval.example.test/root.json";

void test("decodes only plain-name URI fragments", () => {
  assert.equal(decodeJsonSchemaPlainNameFragment("urn:example#n%6Fde"), "node");
  assert.equal(decodeJsonSchemaPlainNameFragment("urn:example#/node"), undefined);
  assert.equal(decodeJsonSchemaPlainNameFragment("urn:example#"), undefined);
  assert.equal(decodeJsonSchemaPlainNameFragment("urn:example"), undefined);
  assert.equal(decodeJsonSchemaPlainNameFragment("urn:example#%ZZ"), undefined);
});

void test("canonicalizes hierarchical absolute and relative URI references", () => {
  assert.equal(
    resolveJsonSchemaUri(baseUri, "HTTP://Example.COM/a/../b/./%7e/%2f?x=%41%2f#f%61%2f"),
    "http://example.com/b/~/%2F?x=A%2F#fa%2F",
  );
  assert.equal(
    resolveJsonSchemaUri(baseUri, "../d/./e?x=%7e%2f#f%61%2f"),
    "https://base.example.test/a/d/e?x=~%2F#fa%2F",
  );
  assert.equal(
    resolveJsonSchemaUri(baseUri, "?x=%7e%2f"),
    "https://base.example.test/a/b/c?x=~%2F",
  );
  assert.equal(resolveJsonSchemaUri(baseUri, "#f%61"), "https://base.example.test/a/b/c?old=1#fa");
  assert.equal(
    resolveJsonSchemaUri(baseUri, "HTTP://EXAMPLE%2fTEST/%2f"),
    "http://example%2Ftest/%2F",
  );
});

void test("only lowercases the scheme of a generic URN", () => {
  assert.equal(
    resolveJsonSchemaUri(baseUri, "URN:Example:Foo%7eBar/%2f"),
    "urn:Example:Foo%7eBar/%2f",
  );
});

void test("canonicalizes ordinary IPv6 and preserves legal IPvFuture colons", () => {
  assert.equal(
    resolveJsonSchemaUri(baseUri, "HTTP://[2001:DB8:0:0::1]/a/../b"),
    "http://[2001:db8::1]/b",
  );
  assert.equal(resolveJsonSchemaUri(baseUri, "FOO://[vF.A:B]/a/../c"), "foo://[vf.a:b]/c");
});

void test("matches an explicit noncanonical registry key to the same reference", () => {
  const externalUri = "HTTPS://EXAMPLE.TEST/schemas/a/../%7Emodel.json";
  const result = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: { [externalUri]: { type: "string" } },
    rootRetrievalUri,
    schema: { $ref: externalUri },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.value.resolve({ from: result.value.root, reference: externalUri })?.location
      .retrievalUri,
    "https://example.test/schemas/~model.json",
  );
});

void test("uses canonical registry identity through the public generated runtime", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    { $ref: "https://example.test/schemas/~model.json" },
    {
      externalSchema: { type: "string" },
      externalSchemaUri: "HTTPS://EXAMPLE.TEST/schemas/a/../%7Emodel.json",
    },
  );

  assert.equal(generatedSchema.safeParse("value").success, true);
  assert.equal(generatedSchema.safeParse(1).success, false);
});

void test("preserves an IPvFuture colon through the public generated runtime", async () => {
  const { generatedSchema } = await compileGeneratedSchema(
    { $ref: "foo://[vf.a:b]/child" },
    { externalSchema: { type: "string" }, externalSchemaUri: "FOO://[vF.A:B]/a/../child" },
  );

  assert.equal(generatedSchema.safeParse("value").success, true);
  assert.equal(generatedSchema.safeParse(1).success, false);
});

void test("matches canonical references to noncanonical identifiers and IPvFuture keys", () => {
  const ipvFutureUri = "FOO://[vF.A:B]/a/../child";
  const graph = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: { [ipvFutureUri]: { type: "number" } },
    rootRetrievalUri,
    schema: { $defs: { target: { $id: "HTTP://EXAMPLE.TEST/a/../%7Etarget", type: "string" } } },
  });

  assert.equal(graph.ok, true);
  assert.equal(
    graph.value.resolve({ from: graph.value.root, reference: "http://example.test/~target" })
      ?.location.pointer,
    "/$defs/target",
  );
  assert.equal(
    graph.value.resolve({ from: graph.value.root, reference: "foo://[vf.a:b]/child" })?.location
      .retrievalUri,
    "foo://[vf.a:b]/child",
  );
});

void test("rejects canonical retrieval and identifier collisions", () => {
  const retrievalCollision = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    externalSchemas: {
      "HTTPS://EXAMPLE.TEST/a/../model.json": true,
      "https://example.test/model.json": false,
    },
    rootRetrievalUri,
    schema: true,
  });
  assert.equal(retrievalCollision.ok, false);

  const identifierCollision = buildJsonSchemaResourceGraph({
    dialect: "draft-2020-12",
    rootRetrievalUri,
    schema: {
      $defs: {
        first: { $id: "HTTP://EXAMPLE.TEST/a/../%7Etarget" },
        second: { $id: "http://example.test/~target" },
      },
    },
  });
  assert.equal(identifierCollision.ok, false);
});

void test("rejects canonical registry collisions through the public compiler", async () => {
  const result = await compileToZodSource({
    document: { source: { id: "canonical-collision", kind: "inline" }, text: "true" },
    output: { typeName: "CanonicalCollision" },
    plugin: jsonSchemaInputPlugin,
    pluginOptions: {
      externalSchemas: {
        "HTTPS://EXAMPLE.TEST/a/../model.json": true,
        "https://example.test/model.json": false,
      },
      validator: "none",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, "invalid_schema_document");
});
