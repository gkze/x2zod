import { jsonPointerSchema } from "@x2zod/core";
import type { JsonPointer } from "@x2zod/core";
import type { z } from "zod/v4";

import type { JsonSchemaValue } from "./document";
import type { JsonSchemaInputPluginOptions } from "./options";
import { emptyPointer, jsonSchemaAtPointer, jsonSchemaLocalRefToPointer } from "./pointer";

const hashPrefixLength = 1;

export type JsonSchemaAddress = string & z.$brand<"JsonSchemaAddress">;
export type JsonSchemaExternalUri = string & z.$brand<"JsonSchemaExternalUri">;

export type ResolvedJsonSchemaReference = Readonly<{
  address: JsonSchemaAddress;
  pointer: JsonPointer;
  schema: JsonSchemaValue;
}>;

export const jsonSchemaAddress = (value: string): JsonSchemaAddress => value as JsonSchemaAddress;

const externalUri = (value: string): JsonSchemaExternalUri => value as JsonSchemaExternalUri;

const schemaAddress = (uri: JsonSchemaExternalUri, pointer: JsonPointer): JsonSchemaAddress =>
  jsonSchemaAddress(`${uri}#${pointer}`);

const resolveExternalPointer = (
  ref: string,
): Readonly<{ pointer: JsonPointer; uri: JsonSchemaExternalUri }> | undefined => {
  try {
    const url = new URL(ref);
    const pointerText =
      url.hash === "" ? emptyPointer : decodeURIComponent(url.hash.slice(hashPrefixLength));
    const pointer = jsonPointerSchema.safeParse(pointerText);
    if (!pointer.success) return undefined;
    url.hash = "";
    return { pointer: pointer.data, uri: externalUri(url.href) };
  } catch {
    return undefined;
  }
};

export const resolveJsonSchemaReference = (
  ref: string,
  rootSchema: JsonSchemaValue,
  options: JsonSchemaInputPluginOptions,
): ResolvedJsonSchemaReference | undefined => {
  const localPointer = jsonSchemaLocalRefToPointer(ref);
  if (localPointer !== undefined) {
    const schema = jsonSchemaAtPointer(rootSchema, localPointer);
    return schema === undefined
      ? undefined
      : { address: jsonSchemaAddress(localPointer), pointer: localPointer, schema };
  }

  const externalPointer = resolveExternalPointer(ref);
  if (externalPointer === undefined) return undefined;

  const externalSchema = options.externalSchemas[externalPointer.uri];
  if (externalSchema === undefined) return undefined;

  const schema = jsonSchemaAtPointer(externalSchema, externalPointer.pointer);
  return schema === undefined
    ? undefined
    : {
        address: schemaAddress(externalPointer.uri, externalPointer.pointer),
        pointer: externalPointer.pointer,
        schema,
      };
};
