import AjvDraft7 from "ajv";
import type { ErrorObject, Options } from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";

import { createDiagnostic, err, jsonPointerSchema, ok } from "@x2zod/core";
import type { Diagnostic, JsonPointer, Result, SourceLocationMap } from "@x2zod/core";

import { jsonSchemaDiagnosticLocation } from "./diagnostics";
import { jsonPointerFromPath } from "./document";
import type { JsonSchemaValue } from "./document";
import type { JsonSchemaDialect, JsonSchemaValidator } from "./options";

const ajvOptions = { allErrors: true, strict: false, validateSchema: true } satisfies Options;

const rootPointer = jsonPointerFromPath([]);

type PreflightJsonSchemaRequest = Readonly<{
  dialect: JsonSchemaDialect;
  locations?: SourceLocationMap | undefined;
  schema: JsonSchemaValue;
  validator: JsonSchemaValidator;
}>;

const ajvPathToPointer = (instancePath: string): JsonPointer => {
  if (instancePath === "") return rootPointer;
  if (instancePath.startsWith("/")) {
    const parsed = jsonPointerSchema.safeParse(instancePath);
    if (parsed.success) return parsed.data;
  }
  return rootPointer;
};

const ajvForDialect = (dialect: JsonSchemaDialect): AjvDraft7 | AjvDraft2019 | AjvDraft2020 => {
  if (dialect === "draft-2020-12") return new AjvDraft2020(ajvOptions);
  if (dialect === "draft-2019-09") return new AjvDraft2019(ajvOptions);
  return new AjvDraft7(ajvOptions);
};

const diagnosticForError = (error: ErrorObject, locations?: SourceLocationMap): Diagnostic => {
  const pointer = ajvPathToPointer(error.instancePath);
  return createDiagnostic({
    code: "invalid_schema_document",
    location: jsonSchemaDiagnosticLocation(pointer, locations),
    message: `JSON Schema document failed Ajv preflight: ${error.message ?? error.keyword}.`,
  });
};

export const preflightJsonSchema = ({
  dialect,
  locations,
  schema,
  validator,
}: PreflightJsonSchemaRequest): Result<JsonSchemaValue> => {
  if (validator === "none") return ok(schema);

  const ajv = ajvForDialect(dialect);
  try {
    const valid = ajv.validateSchema(schema);
    if (valid === true) return ok(schema);

    const diagnostics = (ajv.errors ?? []).map((error) => diagnosticForError(error, locations));
    const [firstDiagnostic, ...remainingDiagnostics] = diagnostics;
    return firstDiagnostic === undefined
      ? err(
          createDiagnostic({
            code: "invalid_schema_document",
            location: jsonSchemaDiagnosticLocation(rootPointer, locations),
            message: "JSON Schema document failed Ajv preflight.",
          }),
        )
      : err(firstDiagnostic, ...remainingDiagnostics);
  } catch (error) {
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        location: jsonSchemaDiagnosticLocation(rootPointer, locations),
        message: `JSON Schema document failed Ajv preflight: ${
          error instanceof Error ? error.message : "Unknown validation failure."
        }`,
      }),
    );
  }
};
