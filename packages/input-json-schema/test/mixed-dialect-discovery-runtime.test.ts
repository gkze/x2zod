import assert from "node:assert/strict";
import { test } from "node:test";

import { compileGeneratedSchema } from "./generated-schema-harness";

const invalidTupleItem = 42;

void test("preserves registered resources across stock-dialect transitions", async () => {
  const transitions = [
    {
      resource: { additionalItems: false, items: [{ type: "string" }] },
      resourceDialect: "http://json-schema.org/draft-07/schema#",
      rootDialect: "https://json-schema.org/draft/2020-12/schema",
    },
    {
      resource: { items: false, prefixItems: [{ type: "string" }] },
      resourceDialect: "https://json-schema.org/draft/2020-12/schema",
      rootDialect: "http://json-schema.org/draft-07/schema#",
    },
    {
      resource: { items: false, prefixItems: [{ type: "string" }] },
      resourceDialect: "https://json-schema.org/draft/2020-12/schema",
      rootDialect: "https://json-schema.org/draft/2019-09/schema",
    },
  ] as const;
  const generatedSchemas = await Promise.all(
    transitions.map(async ({ resource, resourceDialect, rootDialect }, index) => {
      const resourceUri = `https://example.test/transition-${index.toString()}`;
      const fixture = await compileGeneratedSchema(
        { $ref: resourceUri, $schema: rootDialect },
        {
          externalSchema: {
            $id: resourceUri,
            $schema: resourceDialect,
            ...resource,
            type: "array",
          },
          externalSchemaUri: resourceUri,
        },
      );
      return fixture;
    }),
  );

  for (const [index, { generatedSchema }] of generatedSchemas.entries()) {
    const rootDialect = transitions[index]?.rootDialect;
    assert.equal(generatedSchema.safeParse(["accepted"]).success, true, rootDialect);
    assert.equal(generatedSchema.safeParse(["accepted", "extra"]).success, false, rootDialect);
    assert.equal(generatedSchema.safeParse([1]).success, false, rootDialect);
  }
});

void test("lowers an embedded custom Draft 7 resource with tuple semantics", async () => {
  const { generatedSchema, source } = await compileGeneratedSchema({
    $defs: {
      meta: {
        $id: "urn:example:embedded-meta-7",
        $schema: "http://json-schema.org/draft-07/schema#",
      },
      model: {
        $id: "urn:example:embedded-model-7",
        $schema: "urn:example:embedded-meta-7",
        additionalItems: false,
        items: [{ type: "string" }],
        type: "array",
      },
    },
    $ref: "urn:example:embedded-model-7",
    $schema: "https://json-schema.org/draft/2020-12/schema",
  });

  assert.ok(source.includes('"prefixItems": ['));
  assert.ok(source.includes('"additionalItems":'));
  assert.equal(generatedSchema.safeParse(["ok"]).success, true);
  assert.equal(generatedSchema.safeParse([invalidTupleItem]).success, false);
  assert.equal(generatedSchema.safeParse(["ok", "extra"]).success, false);
});

void test("discovers a Draft 7 dialect through an external and embedded metaschema chain", async () => {
  const externalMetaUri = "urn:example:external-meta-7";
  const { generatedSchema, source } = await compileGeneratedSchema(
    {
      $defs: {
        meta: { $id: "urn:example:chained-embedded-meta-7", $schema: externalMetaUri },
        model: {
          $id: "urn:example:chained-model-7",
          $schema: "urn:example:chained-embedded-meta-7",
          additionalItems: false,
          items: [{ type: "string" }],
          type: "array",
        },
      },
      $ref: "urn:example:chained-model-7",
      $schema: "https://json-schema.org/draft/2020-12/schema",
    },
    {
      externalSchema: { $id: externalMetaUri, $schema: "http://json-schema.org/draft-07/schema#" },
      externalSchemaUri: externalMetaUri,
    },
  );

  assert.ok(source.includes('"prefixItems": ['));
  assert.ok(source.includes('"additionalItems":'));
  assert.equal(generatedSchema.safeParse(["ok"]).success, true);
  assert.equal(generatedSchema.safeParse([invalidTupleItem]).success, false);
  assert.equal(generatedSchema.safeParse(["ok", "extra"]).success, false);
});
