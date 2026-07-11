import { getNodePath, getNodeValue, parseTree, printParseErrorCode } from "jsonc-parser";
import type { JSONPath, Node, ParseError } from "jsonc-parser";
import type { JsonObject, JsonPrimitive, JsonValue } from "type-fest";
import { z } from "zod/v4";

import { createDiagnostic, err, jsonPointerSchema, ok } from "@x2zod/core";
import type {
  Diagnostic,
  InputDocument,
  JsonPointer,
  PreparedInput,
  Result,
  SourcePosition,
  SourceSpan,
} from "@x2zod/core";

import { resultFromJsonSchemaDiagnostics } from "./diagnostics";

const emptyPointer = "";
const lineFeed = "\n";

export type { JsonObject, JsonPrimitive, JsonValue } from "type-fest";

export type JsonSchemaValue = boolean | JsonObject;

export type ParsedJsonSchemaDocument = Readonly<{
  schema: JsonSchemaValue;
  source: InputDocument["source"];
}>;

type SourceRange = Readonly<{ length: number; offset: number }>;

type LocationCollectionContext = Readonly<{
  document: InputDocument;
  lineStarts: readonly number[];
  locations: Map<JsonPointer, SourceSpan>;
}>;

const jsonValueSchema: z.ZodType<JsonValue> = z.json();

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema).readonly();

const jsonSchemaValueSchemaValue: z.ZodType<JsonSchemaValue> = z.union([
  z.boolean(),
  jsonObjectSchema,
]);
export const jsonSchemaValueSchema: z.ZodType<JsonSchemaValue> = jsonSchemaValueSchemaValue;

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonArray = (value: JsonValue | undefined): value is readonly JsonValue[] =>
  Array.isArray(value);

export const isJsonPrimitive = (value: JsonValue | undefined): value is JsonPrimitive =>
  value === null || ["boolean", "number", "string"].includes(typeof value);

export const isJsonSchemaValue = (value: JsonValue | undefined): value is JsonSchemaValue =>
  typeof value === "boolean" || isJsonObject(value);

export const jsonStringValues = (values: readonly JsonValue[]): readonly string[] => {
  const strings: string[] = [];
  for (const value of values) if (typeof value === "string") strings.push(value);
  return strings;
};

const sourceFile = (source: InputDocument["source"]): string => {
  if (source.kind === "file") return source.path;
  if (source.kind === "uri") return source.uri;
  return source.id;
};

const escapePointerSegment = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

export const jsonPointerFromPath = (path: JSONPath): JsonPointer =>
  jsonPointerSchema.parse(
    path.length === 0
      ? emptyPointer
      : `/${path
          .map(String)
          .map((segment) => escapePointerSegment(segment))
          .join("/")}`,
  );

const lineStartOffsets = (text: string): readonly number[] => {
  const starts: number[] = [0];
  for (let index = 0; index < text.length; index += 1)
    if (text[index] === lineFeed) starts.push(index + lineFeed.length);

  return starts;
};

const sourcePositionAt = (lineStarts: readonly number[], offset: number): SourcePosition => {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    const nextLineStart = lineStarts[mid + 1];
    if (offset < lineStart) high = mid - 1;
    else if (nextLineStart !== undefined && offset >= nextLineStart) low = mid + 1;
    else return { column: offset - lineStart + 1, line: mid + 1 };
  }

  return { column: offset + 1, line: 1 };
};

const sourceSpanAt = (
  document: InputDocument,
  lineStarts: readonly number[],
  range: SourceRange,
): SourceSpan => ({
  end: sourcePositionAt(lineStarts, range.offset + range.length),
  file: sourceFile(document.source),
  start: sourcePositionAt(lineStarts, range.offset),
});

const parseErrorDiagnostic = (
  document: InputDocument,
  lineStarts: readonly number[],
  error: ParseError,
): Diagnostic =>
  createDiagnostic({
    code: "invalid_schema_document",
    location: {
      pointer: jsonPointerFromPath([]),
      sourceSpan: sourceSpanAt(document, lineStarts, {
        length: error.length,
        offset: error.offset,
      }),
    },
    message: `JSON Schema document is invalid JSON: ${printParseErrorCode(error.error)}.`,
  });

const collectLocation = (context: LocationCollectionContext, node: Node): void => {
  if (node.type !== "property")
    context.locations.set(
      jsonPointerFromPath(getNodePath(node)),
      sourceSpanAt(context.document, context.lineStarts, {
        length: node.length,
        offset: node.offset,
      }),
    );

  for (const child of node.children ?? []) collectLocation(context, child);
};

const parseJsonValue = (root: Node): Result<JsonSchemaValue> => {
  const parsed = jsonSchemaValueSchemaValue.safeParse(getNodeValue(root));
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: "invalid_schema_document",
          location: { pointer: jsonPointerFromPath([]) },
          message: "JSON Schema document root must be a boolean schema or an object schema.",
        }),
      );
};

export const parseJsonSchemaDocument = (
  document: InputDocument,
): Result<PreparedInput<ParsedJsonSchemaDocument>> => {
  const parseErrors: ParseError[] = [];
  const lineStarts = lineStartOffsets(document.text);
  const root = parseTree(document.text, parseErrors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  const [firstParseError, ...remainingParseErrors] = parseErrors;
  if (firstParseError !== undefined)
    return err(
      parseErrorDiagnostic(document, lineStarts, firstParseError),
      ...remainingParseErrors.map((error) => parseErrorDiagnostic(document, lineStarts, error)),
    );

  if (root === undefined)
    return err(
      createDiagnostic({
        code: "invalid_schema_document",
        location: { pointer: jsonPointerFromPath([]) },
        message: "JSON Schema document is empty.",
      }),
    );

  const schema = parseJsonValue(root);
  if (!schema.ok) return schema;

  const locations = new Map<JsonPointer, SourceSpan>();
  collectLocation({ document, lineStarts, locations }, root);

  return resultFromJsonSchemaDiagnostics(
    { locations, value: { schema: schema.value, source: document.source } },
    schema.diagnostics ?? [],
  );
};
