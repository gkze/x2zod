import type { JsonPointer, Result } from "@x2zod/core";

import type { JsonSchemaValue } from "./document";
import type { JsonSchemaDialect } from "./metadata";

export type JsonSchemaLocationId = string;

export type JsonSchemaResourceLocation = Readonly<{
  baseUri: string;
  id: JsonSchemaLocationId;
  pointer: JsonPointer;
  resourceUri: string;
  retrievalUri: string;
  schema: JsonSchemaValue;
}>;

export type JsonSchemaResource = Readonly<{
  aliases: readonly string[];
  canonicalUri: string;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  retrievalUri: string;
}>;

export type ResolvedJsonSchemaGraphReference = Readonly<{
  location: JsonSchemaResourceLocation;
  resolvedUri: string;
}>;

export type ResolveJsonSchemaGraphReferenceRequest = Readonly<{
  from: JsonSchemaLocationId;
  reference: string;
}>;

export type JsonSchemaResourceGraph = Readonly<{
  children: (id: JsonSchemaLocationId) => readonly JsonSchemaResourceLocation[];
  location: (id: JsonSchemaLocationId) => JsonSchemaResourceLocation | undefined;
  locations: readonly JsonSchemaResourceLocation[];
  reachableLocations: readonly JsonSchemaLocationId[];
  reachableFrom: (root: JsonSchemaLocationId) => Result<readonly JsonSchemaLocationId[]>;
  resolve: (
    request: ResolveJsonSchemaGraphReferenceRequest,
  ) => ResolvedJsonSchemaGraphReference | undefined;
  resolveUnique: (
    request: ResolveJsonSchemaGraphReferenceRequest,
  ) => Result<ResolvedJsonSchemaGraphReference | null>;
  resources: readonly JsonSchemaResource[];
  root: JsonSchemaLocationId;
  validateResourceDocuments: (retrievalUris: ReadonlySet<string>) => Result<true>;
}>;

export type BuildJsonSchemaResourceGraphRequest = Readonly<{
  dialect: JsonSchemaDialect;
  externalSchemas?: Readonly<Record<string, JsonSchemaValue>> | undefined;
  rootRetrievalUri?: string | undefined;
  schema: JsonSchemaValue;
}>;
