import { readFileSync } from "node:fs";

import { compileToZodSource } from "@x2zod/core";

import {
  diagnosticText,
  optionalArgument,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
import { jsonSchemaInputPlugin } from "../src";

const schemaPathArgumentIndex = 2;
const externalSchemaPathArgumentIndex = 3;
const externalSchemaUri = "https://example.com/model.schema.json";
const runtimeCaseTypeName = "RuntimeCase";

const schemaPath = requiredArgument(schemaPathArgumentIndex, "JSON Schema fixture");
const externalSchemaPath = optionalArgument(externalSchemaPathArgumentIndex);
const externalSchemas =
  externalSchemaPath === undefined
    ? {}
    : { [externalSchemaUri]: JSON.parse(readFileSync(externalSchemaPath, "utf8")) as unknown };

const result = await compileToZodSource({
  document: { source: { kind: "file", path: schemaPath }, text: readFileSync(schemaPath, "utf8") },
  output: { typeName: runtimeCaseTypeName },
  plugin: jsonSchemaInputPlugin,
  pluginOptions: { externalSchemas, validator: "none" },
});

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

writeNativeSourceFile(result.value.sourceFile);
