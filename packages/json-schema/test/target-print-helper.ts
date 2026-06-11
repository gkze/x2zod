import { readFileSync } from "node:fs";

import { compileToZodSource } from "@x2zod/core";

import {
  diagnosticText,
  optionalArgument,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
import { jsonSchemaInputPlugin, jsonSchemaInputPluginOptionsSchema } from "../src";

const schemaPathArgumentIndex = 2;
const typeNameArgumentIndex = 3;
const optionsPathArgumentIndex = 4;

const schemaPath = requiredArgument(schemaPathArgumentIndex, "JSON Schema fixture");
const typeName = requiredArgument(typeNameArgumentIndex, "output type name");
const optionsPath = optionalArgument(optionsPathArgumentIndex);
const pluginOptions =
  optionsPath === undefined
    ? {}
    : jsonSchemaInputPluginOptionsSchema.parse(JSON.parse(readFileSync(optionsPath, "utf8")));

const result = await compileToZodSource({
  document: { source: { kind: "file", path: schemaPath }, text: readFileSync(schemaPath, "utf8") },
  output: { typeName },
  plugin: jsonSchemaInputPlugin,
  pluginOptions,
});

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

writeNativeSourceFile(result.value.sourceFile);
