import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { compileToZodSource, declarationExportModeSchema } from "@x2zod/core";
import type { ZodEmissionTransformInput } from "@x2zod/core";

import {
  diagnosticText,
  requiredArgument,
  writeNativeSourceFile,
} from "../../../test/native-print-helper";
import { jsonSchemaDialectSchema, jsonSchemaInputPlugin, jsonSchemaValueSchema } from "../src";

const schemaPathArgumentIndex = 2;
const dialectArgumentPrefix = "--dialect=";
const declarationExportModeArgumentPrefix = "--declaration-export-mode=";
const externalSchemaUriArgumentPrefix = "--external-schema-uri=";
const mapPropertiesArgument = "--map-properties";
const defaultExternalSchemaUri = "https://example.com/model.schema.json";
const runtimeCaseTypeName = "RuntimeCase";

const schemaPath = requiredArgument(schemaPathArgumentIndex, "JSON Schema fixture");
const runtimeArguments = process.argv.slice(schemaPathArgumentIndex + 1);
const dialectArgument = runtimeArguments.find((argument) =>
  argument.startsWith(dialectArgumentPrefix),
);
const dialect =
  dialectArgument === undefined
    ? undefined
    : jsonSchemaDialectSchema.parse(dialectArgument.slice(dialectArgumentPrefix.length));
const declarationExportModeArgument = runtimeArguments.find((argument) =>
  argument.startsWith(declarationExportModeArgumentPrefix),
);
const declarationExportMode =
  declarationExportModeArgument === undefined
    ? "root"
    : declarationExportModeSchema.parse(
        declarationExportModeArgument.slice(declarationExportModeArgumentPrefix.length),
      );
const externalSchemaPath = runtimeArguments.find(
  (argument) =>
    argument !== mapPropertiesArgument &&
    !argument.startsWith(declarationExportModeArgumentPrefix) &&
    !argument.startsWith(dialectArgumentPrefix) &&
    !argument.startsWith(externalSchemaUriArgumentPrefix),
);
const externalSchemaUriArgument = runtimeArguments.find((argument) =>
  argument.startsWith(externalSchemaUriArgumentPrefix),
);
const externalSchemaUri =
  externalSchemaUriArgument === undefined
    ? defaultExternalSchemaUri
    : externalSchemaUriArgument.slice(externalSchemaUriArgumentPrefix.length);
const externalSchemas =
  externalSchemaPath === undefined
    ? {}
    : {
        [externalSchemaUri]: jsonSchemaValueSchema.parse(
          JSON.parse(readFileSync(externalSchemaPath, "utf8")),
        ),
      };

const transforms: readonly ZodEmissionTransformInput[] = runtimeArguments.includes(
  mapPropertiesArgument,
)
  ? [{ kind: "map-properties", options: { keys: { decodedCase: "camelCase", kind: "case" } } }]
  : [];

const result = await compileToZodSource({
  document: {
    source: { kind: "file", path: schemaPath },
    text: readFileSync(schemaPath, "utf8"),
    retrievalUri: pathToFileURL(schemaPath).href,
  },
  output: { declarationExportMode, typeName: runtimeCaseTypeName },
  plugin: jsonSchemaInputPlugin,
  pluginOptions: {
    externalSchemas,
    ...(dialect === undefined ? {} : { dialect }),
    validator: "none",
  },
  transforms,
});

if (!result.ok) throw new Error(diagnosticText(result.diagnostics));

writeNativeSourceFile(result.value.sourceFile);
