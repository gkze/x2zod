import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInputs } from "@x2zod/build-inputs";

import { isJsonObject } from "../../src/document";
import {
  fixtureDirectory,
  inventoryManifestFile,
  inventoryManifestSchema,
  parseJsonFile,
  readSuiteFile,
  scanRequiredInventory,
} from "./fixture-support";
import type { OfficialSuiteCase } from "./fixture-support";

const specialPropertiesGroupIndex = 5;
const invalidPrototypeCaseIndex = 3;
const validPrototypeCaseIndex = 6;

void test("pins and inventories the official required suite", async () => {
  const manifest = await parseJsonFile(inventoryManifestFile, inventoryManifestSchema);
  const result = await buildInputs({ mode: "check", rootDir: fixtureDirectory });
  assert.equal(result.lockfileUpdated, false);
  assert.equal(result.inputs.length, 1);
  const [input] = result.inputs;
  assert.ok(input !== undefined);
  assert.equal(input.type, "archive");
  assert.equal(input.url, manifest.suite.archiveUrl);
  assert.equal(input.sourceSha256, manifest.suite.archiveSha256);
  assert.deepEqual(await scanRequiredInventory(), manifest.required);
});

void test("preserves special object keys from the official JSON bytes", async () => {
  const groups = await readSuiteFile("draft-7", "properties.json");
  const group = groups.at(specialPropertiesGroupIndex);
  assert.ok(group !== undefined);
  assert.ok(isJsonObject(group.schema));
  const { properties } = group.schema;
  assert.ok(isJsonObject(properties));
  assert.equal(Object.hasOwn(properties, "__proto__"), true);

  for (const testIndex of [invalidPrototypeCaseIndex, validPrototypeCaseIndex]) {
    const suiteCase: OfficialSuiteCase | undefined = group.tests.at(testIndex);
    assert.ok(suiteCase !== undefined);
    assert.ok(isJsonObject(suiteCase.data));
    assert.equal(Object.hasOwn(suiteCase.data, "__proto__"), true);
  }
});
