import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jsonSchemaInputPluginOptionsSchema } from "../src";

const externalSchemaUri = "https://example.com/external.json";
const specialExternalSchemaUri = "https://example.com/special.json";

void describe("jsonSchemaInputPluginOptionsSchema", () => {
  void test("normalizes external schema object and array behavior", () => {
    const externalSchema: Record<string, unknown> = {};
    Object.setPrototypeOf(externalSchema, { type: "string" });
    const overriddenArray = [1];
    Object.defineProperty(overriddenArray, "map", { enumerable: true, value: 0 });
    externalSchema["const"] = overriddenArray;
    const specialSchema: unknown = JSON.parse('{"const":{"__proto__":null}}');

    const parsed = jsonSchemaInputPluginOptionsSchema.parse({
      externalSchemas: {
        [externalSchemaUri]: externalSchema,
        [specialExternalSchemaUri]: specialSchema,
      },
    });
    const normalizedSchema = parsed.externalSchemas[externalSchemaUri];
    assert.notEqual(normalizedSchema, undefined);
    assert.notEqual(typeof normalizedSchema, "boolean");
    if (normalizedSchema === undefined || typeof normalizedSchema === "boolean")
      assert.fail("expected an external object schema");

    assert.equal(Object.hasOwn(normalizedSchema, "type"), false);
    const { const: normalizedArray } = normalizedSchema;
    assert.ok(Array.isArray(normalizedArray));
    assert.deepEqual(normalizedArray, [1]);
    assert.equal(normalizedArray.map, Array.prototype.map);

    const normalizedSpecialSchema = parsed.externalSchemas[specialExternalSchemaUri];
    assert.notEqual(normalizedSpecialSchema, undefined);
    assert.notEqual(typeof normalizedSpecialSchema, "boolean");
    if (normalizedSpecialSchema === undefined || typeof normalizedSpecialSchema === "boolean")
      assert.fail("expected a special-key external object schema");
    const { const: specialValue } = normalizedSpecialSchema;
    assert.ok(typeof specialValue === "object" && specialValue !== null);
    assert.equal(Object.hasOwn(specialValue, "__proto__"), true);
  });

  void test("rejects non-empty external registry fragments", () => {
    assert.throws(
      () =>
        jsonSchemaInputPluginOptionsSchema.parse({
          externalSchemas: { [`${externalSchemaUri}#special`]: { type: "string" } },
        }),
      /fragmentless retrieval URI/u,
    );
  });

  void test("rejects malformed or relative external registry keys", () => {
    for (const uri of ["http://[", "external.json", "https://example.com/%ZZ"])
      assert.throws(
        () =>
          jsonSchemaInputPluginOptionsSchema.parse({
            externalSchemas: { [uri]: { type: "string" } },
          }),
        /valid absolute, fragmentless retrieval URI/u,
      );
  });
});
