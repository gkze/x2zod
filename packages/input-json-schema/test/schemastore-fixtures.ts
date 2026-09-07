import { readFileSync, readdirSync } from "node:fs";
import nodePath from "node:path";

import { jsonSchemaValueSchema } from "../src";
import type { JsonSchemaValue } from "../src";
import { isJsonObject } from "../src/document";

export const schemaStoreFixtureDirectory: string = nodePath.join(
  import.meta.dirname,
  "fixtures/schemastore",
);
export const readSchemaStoreFixture = (file: string): JsonSchemaValue =>
  jsonSchemaValueSchema.parse(
    JSON.parse(readFileSync(nodePath.join(schemaStoreFixtureDirectory, file), "utf8")),
  );

export const schemaStoreExternalSchemas = (
  rootFile: string,
): Readonly<Record<string, JsonSchemaValue>> =>
  Object.fromEntries(
    readdirSync(schemaStoreFixtureDirectory)
      .filter(
        (file) => file.endsWith(".json") && !file.startsWith("build-inputs") && file !== rootFile,
      )
      .map((file) => {
        const schema = readSchemaStoreFixture(file);
        if (!isJsonObject(schema) || typeof schema["$id"] !== "string")
          throw new Error(`SchemaStore fixture ${file} must declare its resource identifier.`);
        return [schema["$id"], schema];
      }),
  );
