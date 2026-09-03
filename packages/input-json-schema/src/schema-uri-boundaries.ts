import { createDiagnostic } from "@x2zod/core";
import type { Diagnostic, JsonPointer } from "@x2zod/core";

import { isJsonObject } from "./document";
import type { JsonObject, JsonSchemaValue } from "./document";
import {
  isValidJsonSchemaAnchorName,
  jsonSchemaAnchorKeywordsForDialect,
  jsonSchemaKeywords,
  jsonSchemaReferenceKeywordsForDialect,
} from "./metadata";
import type { JsonSchemaDialect } from "./metadata";
import { jsonSchemaPointerWithSegment } from "./pointer";
import { isNormalizedJsonSchemaUri, isValidJsonSchemaUriReference } from "./retrieval-uri";
import { isDraft7ReferenceSchema } from "./schema-applicability";
import { compareCodeUnits } from "./string-order";

type SchemaUriBoundaryRequest = Readonly<{
  dialect: JsonSchemaDialect;
  pointer: JsonPointer;
  resourceRoot: boolean;
  schema: JsonSchemaValue;
}>;

const boundaryDiagnostic = (pointer: JsonPointer, keyword: string, message: string): Diagnostic =>
  createDiagnostic({
    code: "invalid_schema_document",
    location: { pointer: jsonSchemaPointerWithSegment(pointer, keyword) },
    message,
  });

const invalidReferenceDiagnostic = (
  schema: JsonObject,
  dialect: JsonSchemaDialect,
  pointer: JsonPointer,
): Diagnostic | undefined => {
  for (const keyword of jsonSchemaReferenceKeywordsForDialect(dialect))
    if (Object.hasOwn(schema, keyword)) {
      const reference = schema[keyword];
      if (
        typeof reference !== "string" ||
        !isValidJsonSchemaUriReference(reference) ||
        (keyword === jsonSchemaKeywords.recursiveRef && reference !== "#")
      )
        return boundaryDiagnostic(
          pointer,
          keyword,
          keyword === jsonSchemaKeywords.recursiveRef
            ? "JSON Schema $recursiveRef must be exactly #."
            : `JSON Schema ${keyword} must be a valid URI-reference.`,
        );
    }
  return undefined;
};

const invalidRecursiveAnchorDiagnostic = (
  schema: JsonObject,
  dialect: JsonSchemaDialect,
  pointer: JsonPointer,
): Diagnostic | undefined =>
  dialect === "draft-2019-09" &&
  Object.hasOwn(schema, jsonSchemaKeywords.recursiveAnchor) &&
  typeof schema[jsonSchemaKeywords.recursiveAnchor] !== "boolean"
    ? boundaryDiagnostic(
        pointer,
        jsonSchemaKeywords.recursiveAnchor,
        "JSON Schema $recursiveAnchor must be a boolean.",
      )
    : undefined;

const invalidAnchorDiagnostic = (
  schema: JsonObject,
  dialect: JsonSchemaDialect,
  pointer: JsonPointer,
): Diagnostic | undefined => {
  for (const keyword of jsonSchemaAnchorKeywordsForDialect(dialect))
    if (Object.hasOwn(schema, keyword)) {
      const anchor = schema[keyword];
      if (typeof anchor !== "string" || !isValidJsonSchemaAnchorName(anchor))
        return boundaryDiagnostic(
          pointer,
          keyword,
          `JSON Schema ${keyword} must be a valid plain-name fragment.`,
        );
    }
  return undefined;
};

const identifierDiagnostic = (
  schema: JsonObject,
  dialect: JsonSchemaDialect,
  pointer: JsonPointer,
): Diagnostic | undefined => {
  if (
    !Object.hasOwn(schema, jsonSchemaKeywords.id) ||
    isDraft7ReferenceSchema(schema, dialect) ||
    typeof schema[jsonSchemaKeywords.id] === "string"
  )
    return undefined;
  return boundaryDiagnostic(pointer, jsonSchemaKeywords.id, "JSON Schema $id must be a string.");
};

const schemaDeclarationDiagnostic = (
  schema: JsonObject,
  pointer: JsonPointer,
  resourceRoot: boolean,
): Diagnostic | undefined => {
  if (!Object.hasOwn(schema, jsonSchemaKeywords.schema)) return undefined;
  if (!resourceRoot)
    return boundaryDiagnostic(
      pointer,
      jsonSchemaKeywords.schema,
      "JSON Schema $schema may appear only at a schema-resource root.",
    );
  const declaration = schema[jsonSchemaKeywords.schema];
  return typeof declaration === "string" && isNormalizedJsonSchemaUri(declaration, true)
    ? undefined
    : boundaryDiagnostic(
        pointer,
        jsonSchemaKeywords.schema,
        "JSON Schema $schema must be a valid normalized URI containing a scheme.",
      );
};

const vocabularyDiagnostic = (
  schema: JsonObject,
  pointer: JsonPointer,
  resourceRoot: boolean,
): Diagnostic | undefined => {
  if (!Object.hasOwn(schema, jsonSchemaKeywords.vocabulary)) return undefined;
  if (!resourceRoot)
    return boundaryDiagnostic(
      pointer,
      jsonSchemaKeywords.vocabulary,
      "JSON Schema $vocabulary may appear only at a schema-resource root.",
    );
  const vocabulary = schema[jsonSchemaKeywords.vocabulary];
  if (!isJsonObject(vocabulary))
    return boundaryDiagnostic(
      pointer,
      jsonSchemaKeywords.vocabulary,
      "JSON Schema $vocabulary must map normalized URIs containing a scheme to booleans.",
    );
  const [invalid] = Object.entries(vocabulary)
    .filter(
      ([uri, required]) => typeof required !== "boolean" || !isNormalizedJsonSchemaUri(uri, false),
    )
    .toSorted(([left], [right]) => compareCodeUnits(left, right));
  return invalid === undefined
    ? undefined
    : boundaryDiagnostic(
        jsonSchemaPointerWithSegment(pointer, jsonSchemaKeywords.vocabulary),
        invalid[0],
        "JSON Schema vocabulary names must be normalized URIs containing a scheme " +
          "with boolean values.",
      );
};

export const jsonSchemaUriBoundaryDiagnostic = ({
  dialect,
  pointer,
  resourceRoot,
  schema,
}: SchemaUriBoundaryRequest): Diagnostic | undefined => {
  if (!isJsonObject(schema)) return undefined;
  const reference = invalidReferenceDiagnostic(schema, dialect, pointer);
  if (reference !== undefined) return reference;
  const anchor = invalidAnchorDiagnostic(schema, dialect, pointer);
  if (anchor !== undefined) return anchor;
  const recursiveAnchor = invalidRecursiveAnchorDiagnostic(schema, dialect, pointer);
  if (recursiveAnchor !== undefined) return recursiveAnchor;
  const identifier = identifierDiagnostic(schema, dialect, pointer);
  if (identifier !== undefined) return identifier;
  const declaration = schemaDeclarationDiagnostic(schema, pointer, resourceRoot);
  if (declaration !== undefined) return declaration;
  return dialect === "draft-7" ? undefined : vocabularyDiagnostic(schema, pointer, resourceRoot);
};
