import type { z } from "zod/v4";

import { isRecord } from "./structural";
import { schemaError } from "./zod-cli-errors";

export type ZodSchema = z.ZodType;
export type ZodSchemaShape = Readonly<Record<string, ZodSchema>>;

export type ZodDef = Readonly<{
  catchall?: unknown;
  check?: unknown;
  checks?: readonly unknown[];
  defaultValue?: unknown;
  element?: unknown;
  entries?: unknown;
  format?: unknown;
  innerType?: unknown;
  shape?: unknown;
  type?: unknown;
}>;

const ZOD_INTERNALS_KEY = "_zod";

export const isZodSchema = (value: unknown): value is ZodSchema =>
  isRecord(value) &&
  typeof value["parse"] === "function" &&
  typeof value["safeParse"] === "function";

export const schemaDef = (schema: ZodSchema, path: readonly string[]): ZodDef => {
  const schemaRecord = schema as unknown as Readonly<{
    _zod?: Readonly<{ def?: unknown }>;
    def?: unknown;
  }>;
  const def = schemaRecord.def ?? schemaRecord[ZOD_INTERNALS_KEY]?.def;

  if (!isRecord(def)) throw schemaError(path, "schema has no introspectable Zod definition");
  return def;
};

export const schemaType = (schema: ZodSchema, path: readonly string[]): string => {
  const { type } = schemaDef(schema, path);
  if (typeof type !== "string") throw schemaError(path, "schema definition has no type");
  return type;
};

export const innerSchema = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  const { innerType } = schemaDef(schema, path);
  if (!isZodSchema(innerType))
    throw schemaError(path, "wrapper schema has no introspectable inner type");
  return innerType;
};

export const isSupportedWrapperType = (type: string): boolean =>
  type === "default" || type === "optional" || type === "readonly";

export const unwrapSupportedWrappers = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  let currentSchema = schema;

  for (;;) {
    const type = schemaType(currentSchema, path);
    if (!isSupportedWrapperType(type)) return currentSchema;
    currentSchema = innerSchema(currentSchema, path);
  }
};

export const unwrapRootObjectSchema = (schema: ZodSchema): ZodSchema => {
  const type = schemaType(schema, []);
  return type === "readonly" ? innerSchema(schema, []) : schema;
};

export const objectShape = (schema: ZodSchema): ZodSchemaShape => {
  const path: readonly string[] = [];
  const def = schemaDef(schema, path);

  if (def.type !== "object") throw schemaError(path, "expected a root Zod object schema");

  assertSupportedCatchall(def, path);

  const shapeCandidate = objectShapeCandidate(def);
  if (!isRecord(shapeCandidate))
    throw schemaError(path, "object schema has no introspectable shape");

  const shape: Record<string, ZodSchema> = {};
  for (const [fieldName, fieldSchema] of Object.entries(shapeCandidate)) {
    if (!isZodSchema(fieldSchema))
      throw schemaError([fieldName], "object field is not an introspectable Zod schema");
    shape[fieldName] = fieldSchema;
  }

  return shape;
};

export const arrayElementSchema = (schema: ZodSchema, path: readonly string[]): ZodSchema => {
  const { element } = schemaDef(schema, path);
  if (!isZodSchema(element)) throw schemaError(path, "array schema has no element schema");
  return unwrapSupportedWrappers(element, [...path, "<element>"]);
};

const assertSupportedCatchall = (def: ZodDef, path: readonly string[]): void => {
  if (def.catchall === undefined) return;
  if (!isZodSchema(def.catchall)) throw schemaError(path, "object catchall is not introspectable");
  if (schemaType(def.catchall, [...path, "<catchall>"]) !== "never")
    throw schemaError(path, "object catchalls and passthrough keys are not supported");
};

const objectShapeCandidate = (def: ZodDef): unknown => {
  if (typeof def.shape !== "function") return def.shape;
  const getShape = def.shape as () => unknown;
  return getShape();
};
