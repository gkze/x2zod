import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import type { JsonSchemaDialect } from "./metadata";
import {
  decodeJsonSchemaUriFragment,
  isValidJsonSchemaUriReference,
  resolveJsonSchemaUri,
  splitJsonSchemaUri,
} from "./retrieval-uri";
import { isDraft7ReferenceSchema } from "./schema-applicability";

export type JsonSchemaIdentifierProjection = Readonly<{
  baseUri: string;
  createsResource: boolean;
  fragment?: string | undefined;
  invalidIdentifier?: boolean | undefined;
  resourceUri: string;
}>;

type ResourceIdentifierContext = Readonly<{
  baseUri: string;
  documentRoot: boolean;
  resourceUri: string;
  schema: JsonSchemaValue;
}>;

const schemaIdentifier = (schema: JsonSchemaValue): string | undefined =>
  isJsonObject(schema) && typeof schema["$id"] === "string" ? schema["$id"] : undefined;

export const projectJsonSchemaIdentifier = (
  context: ResourceIdentifierContext,
  dialect: JsonSchemaDialect,
): JsonSchemaIdentifierProjection => {
  const identifier = isDraft7ReferenceSchema(context.schema, dialect)
    ? undefined
    : schemaIdentifier(context.schema);
  if (identifier === undefined)
    return {
      baseUri: context.baseUri,
      createsResource: context.documentRoot,
      resourceUri: context.resourceUri,
    };
  if (
    !isValidJsonSchemaUriReference(identifier) ||
    (dialect !== "draft-7" && identifier.includes("#") && !identifier.endsWith("#"))
  )
    return {
      baseUri: context.baseUri,
      createsResource: context.documentRoot,
      invalidIdentifier: true,
      resourceUri: context.resourceUri,
    };
  const identifierParts = splitJsonSchemaUri(resolveJsonSchemaUri(context.baseUri, identifier));
  const decodedFragment =
    identifierParts.fragment === undefined
      ? undefined
      : decodeJsonSchemaUriFragment(identifierParts.fragment);
  return {
    baseUri: identifierParts.resourceUri,
    createsResource:
      context.documentRoot ||
      identifierParts.fragment === undefined ||
      identifierParts.resourceUri !== context.resourceUri,
    ...(decodedFragment === undefined
      ? {}
      : { fragment: decodedFragment.value, invalidIdentifier: decodedFragment.invalid }),
    resourceUri: identifierParts.resourceUri,
  };
};
