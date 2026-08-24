import { readFileSync } from "node:fs";

import { compileToZodSource } from "@x2zod/core";

import { printNativeSourceFile, requiredArgument } from "../../../test/native-print-helper";
import {
  jsonSchemaDialectSchema,
  jsonSchemaInputPlugin,
  jsonSchemaInputPluginOptionsSchema,
} from "../src";

const schemaPathArgumentIndex = 2;
const dialectArgumentIndex = 3;
const externalSchemasPathArgumentIndex = 4;
const officialSuiteTypeName = "OfficialSuiteCase";

const schemaPath = requiredArgument(schemaPathArgumentIndex, "JSON Schema suite case");
const dialect = jsonSchemaDialectSchema.parse(
  requiredArgument(dialectArgumentIndex, "JSON Schema dialect"),
);
const externalSchemasPath = requiredArgument(
  externalSchemasPathArgumentIndex,
  "JSON Schema external resources",
);
const pluginOptions = jsonSchemaInputPluginOptionsSchema.parse({
  dialect,
  externalSchemas: JSON.parse(readFileSync(externalSchemasPath, "utf8")) as unknown,
  validator: "none",
});
const result = await compileToZodSource({
  document: { source: { kind: "file", path: schemaPath }, text: readFileSync(schemaPath, "utf8") },
  output: { typeName: officialSuiteTypeName },
  plugin: jsonSchemaInputPlugin,
  pluginOptions,
});

process.stdout.write(
  JSON.stringify(
    result.ok
      ? { ok: true, source: printNativeSourceFile(result.value.sourceFile) }
      : {
          diagnostics: result.diagnostics.map(({ code, location, message, severity }) => ({
            code,
            message,
            pointer: location?.pointer ?? null,
            severity,
          })),
          ok: false,
        },
  ),
);
