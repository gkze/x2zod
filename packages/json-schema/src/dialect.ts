import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result, SourceLocationMap } from "@x2zod/core";

import { jsonSchemaDiagnosticLocation } from "./diagnostics";
import { isJsonObject, jsonPointerFromPath } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import type { JsonSchemaDialect } from "./options";

const draft202012SchemaUris = new Set<string>([
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2020-12/schema#",
]);

const draft7SchemaUris = new Set<string>([
  "http://json-schema.org/draft-07/schema",
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft-07/schema",
  "https://json-schema.org/draft-07/schema#",
]);

const schemaPointer = jsonPointerFromPath([jsonSchemaKeywords.schema]);

const dialectFromSchemaUri = (uri: string): JsonSchemaDialect | undefined => {
  if (draft202012SchemaUris.has(uri)) return "draft-2020-12";
  if (draft7SchemaUris.has(uri)) return "draft-7";
  return undefined;
};

export const declaredJsonSchemaDialect = (
  schema: JsonSchemaValue,
): Readonly<{ dialect?: JsonSchemaDialect; uri?: string }> => {
  if (!isJsonObject(schema)) return {};
  const schemaUri = schema[jsonSchemaKeywords.schema];
  if (typeof schemaUri !== "string") return {};
  const dialect = dialectFromSchemaUri(schemaUri);
  return dialect === undefined ? { uri: schemaUri } : { dialect, uri: schemaUri };
};

export const resolveJsonSchemaDialect = (
  schema: JsonSchemaValue,
  requestedDialect: JsonSchemaDialect,
  locations?: SourceLocationMap,
): Result<JsonSchemaDialect> => {
  const declared = declaredJsonSchemaDialect(schema);
  if (declared.uri === undefined) return ok(requestedDialect);
  if (declared.dialect === undefined)
    return err(
      createDiagnostic({
        code: "unsupported_dialect",
        location: jsonSchemaDiagnosticLocation(schemaPointer, locations),
        message: `JSON Schema dialect is not supported: ${declared.uri}.`,
      }),
    );
  if (declared.dialect !== requestedDialect)
    return err(
      createDiagnostic({
        code: "dialect_conflict",
        location: jsonSchemaDiagnosticLocation(schemaPointer, locations),
        message: `JSON Schema declares dialect ${declared.dialect} but plugin options requested ${requestedDialect}.`,
      }),
    );

  return ok(declared.dialect);
};
