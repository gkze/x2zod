import { readFileSync } from "node:fs";

import { compileToZodSource } from "@x2zod/core";

import {
  diagnosticText,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
import { jsonSchemaInputPlugin, jsonSchemaValueSchema } from "../src";

const modelSchemaUri = "https://models.dev/model-schema.json";
const openCodeConfigTypeName = "OpenCodeConfig";
const configSchemaPathArgumentIndex = 2;
const modelSchemaPathArgumentIndex = 3;

const configSchemaPath = requiredArgument(
  configSchemaPathArgumentIndex,
  "OpenCode config schema fixture",
);
const modelSchemaPath = requiredArgument(modelSchemaPathArgumentIndex, "models.dev schema fixture");
const configSchemaText = readFileSync(configSchemaPath, "utf8");
const modelSchema = jsonSchemaValueSchema.parse(JSON.parse(readFileSync(modelSchemaPath, "utf8")));

const result = await compileToZodSource({
  document: { source: { kind: "file", path: configSchemaPath }, text: configSchemaText },
  output: { typeName: openCodeConfigTypeName },
  plugin: jsonSchemaInputPlugin,
  pluginOptions: { externalSchemas: { [modelSchemaUri]: modelSchema }, sourceProfile: "opencode" },
});

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

writeNativeSourceFile(result.value.sourceFile);
