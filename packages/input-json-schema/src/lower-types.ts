import type { Diagnostic, JsonPointer, SourceLocationMap, ZodDeclaration } from "@x2zod/core";

import type { JsonSchemaDialectPolicy } from "./dialect";
import type { JsonObject, JsonSchemaValue } from "./document";
import type { ResolvedJsonSchemaInputPluginOptions } from "./options";
import type { JsonSchemaAddress, JsonSchemaReferenceResolver } from "./reference";
import type { JsonSchemaLocationId } from "./resource-graph";

export type { JsonSchemaLocationId } from "./resource-graph";

export type LoweringContext = Readonly<{
  declarations: Map<JsonSchemaAddress, ZodDeclaration>;
  declarationLocations: Map<JsonSchemaAddress, JsonSchemaLocationId>;
  diagnostics: Diagnostic[];
  formatAssertionVocabulary: boolean;
  resourcePolicies: ReadonlyMap<JsonSchemaLocationId, JsonSchemaDialectPolicy>;
  locations?: SourceLocationMap;
  options: ResolvedJsonSchemaInputPluginOptions;
  validationVocabulary: boolean;
  references: JsonSchemaReferenceResolver;
  visiting: Set<JsonSchemaAddress>;
}>;

export type LocatedSchemaRequest<TSchema extends JsonSchemaValue = JsonSchemaValue> = Readonly<{
  context: LoweringContext;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  schema: TSchema;
}>;

export type LowerTypeRequest = LocatedSchemaRequest<JsonObject> &
  Readonly<{ typeValuePointer: JsonPointer }>;

export type LowerChildSchemaRequest = Readonly<{
  context: LoweringContext;
  parent: JsonSchemaLocationId;
  pointer: JsonPointer;
  schema: JsonSchemaValue;
}>;

export type LowerReferenceRequest = Readonly<{
  context: LoweringContext;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  ref: string;
}>;

export type DeclareSchemaRequest = Readonly<{
  address: JsonSchemaAddress;
  location: JsonSchemaLocationId;
  pointer: JsonPointer;
  schema: JsonSchemaValue;
}>;
