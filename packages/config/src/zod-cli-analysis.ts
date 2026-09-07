import { ensureNonEmptyString } from "@optique/core";
import type { NonEmptyString, OptionName } from "@optique/core";

import { isRecord } from "./structural";
import { schemaError, ZodCLIOptionSchemaError } from "./zod-cli-errors";
import { optionNamesForField, readCLIMetadata } from "./zod-cli-metadata";
import type { ZodCLIOptionMetadata } from "./zod-cli-metadata";
import {
  arrayElementSchema,
  objectShape,
  schemaAllowsOmission,
  schemaDef,
  unwrapRootObjectSchema,
  unwrapSupportedWrappers,
} from "./zod-introspection";
import type { ZodDef, ZodSchema } from "./zod-introspection";

export type ZodCLIValue =
  | Readonly<{ kind: "boolean" | "integer" | "number" | "string"; valueName: NonEmptyString }>
  | Readonly<{ kind: "enum"; values: readonly string[]; valueName: NonEmptyString }>;

export type ZodCLIField = Readonly<{
  optional: boolean;
  fieldName: string;
  metadata: ZodCLIOptionMetadata;
  optionNames: readonly [OptionName, OptionName];
  repeatable: boolean;
  schema: ZodSchema;
  value: ZodCLIValue;
}>;

const optionValueName = (metadata: ZodCLIOptionMetadata, fallback: string): NonEmptyString => {
  const valueName = metadata.valueName ?? fallback;
  try {
    ensureNonEmptyString(valueName);
    return valueName;
  } catch (error) {
    if (error instanceof Error)
      throw new ZodCLIOptionSchemaError([], `invalid CLI value name: ${error.message}`);
    throw error;
  }
};

const enumValues = (def: ZodDef, path: readonly string[]): readonly string[] => {
  if (!isRecord(def.entries)) throw schemaError(path, "enum schema has no entries");
  const values = [...new Set(Object.values(def.entries))];
  if (values.length === 0) throw schemaError(path, "empty enums are not supported");
  if (!values.every((value) => typeof value === "string"))
    throw schemaError(path, "only string enums are supported");
  return values;
};

const isSafeIntegerNumberFormat = (def: ZodDef): boolean =>
  def.check === "number_format" && def.format === "safeint";

const isIntegerNumber = (def: ZodDef): boolean =>
  isSafeIntegerNumberFormat(def) ||
  (def.checks ?? []).some((check) => {
    if (!isRecord(check)) return false;
    const nestedDef = isRecord(check["def"]) ? (check["def"] as ZodDef) : undefined;
    return (
      isSafeIntegerNumberFormat(check) ||
      (nestedDef !== undefined && isSafeIntegerNumberFormat(nestedDef))
    );
  });

const valueForMode = (
  metadata: ZodCLIOptionMetadata,
  type: unknown,
  path: readonly string[],
): ZodCLIValue => {
  if (
    (metadata.valueMode === "string-map" || metadata.valueMode === "boolean-map") &&
    type !== "record"
  )
    throw schemaError(path, `${metadata.valueMode} CLI option value mode requires a Zod record`);
  return { kind: "string", valueName: optionValueName(metadata, "VALUE") };
};

const valueForSchema = (
  schema: ZodSchema,
  metadata: ZodCLIOptionMetadata,
  path: readonly string[],
): ZodCLIValue => {
  const def = schemaDef(schema, path);
  switch (def.type) {
    case "boolean": {
      return { kind: "boolean", valueName: optionValueName(metadata, "BOOLEAN") };
    }
    case "enum": {
      return {
        kind: "enum",
        valueName: optionValueName(metadata, "VALUE"),
        values: enumValues(def, path),
      };
    }
    case "number": {
      return isIntegerNumber(def)
        ? { kind: "integer", valueName: optionValueName(metadata, "INTEGER") }
        : { kind: "number", valueName: optionValueName(metadata, "NUMBER") };
    }
    case "string": {
      return { kind: "string", valueName: optionValueName(metadata, "STRING") };
    }
    default: {
      throw schemaError(
        path,
        `unsupported CLI option schema type ${typeof def.type === "string" ? def.type : "<unknown>"}`,
      );
    }
  }
};

export const analyzeZodCLIFields = (schema: ZodSchema): readonly ZodCLIField[] => {
  const shape = objectShape(unwrapRootObjectSchema(schema));
  const optionNameSources = new Map<string, string>();
  return Object.entries(shape).map(([fieldName, fieldSchema]) => {
    const path = [fieldName];
    const metadata = readCLIMetadata(fieldSchema, path);
    const optionNames = optionNamesForField(fieldName, metadata, path);
    for (const name of optionNames) {
      const previousFieldName = optionNameSources.get(name);
      if (previousFieldName !== undefined)
        throw schemaError(path, `option name ${name} is already used by ${previousFieldName}`);
      optionNameSources.set(name, fieldName);
    }

    const baseSchema = unwrapSupportedWrappers(fieldSchema, path);
    const def = schemaDef(baseSchema, path);
    const repeatable = metadata.valueMode !== undefined || def.type === "array";
    const value =
      metadata.valueMode === undefined
        ? valueForSchema(
            def.type === "array" ? arrayElementSchema(baseSchema, path) : baseSchema,
            metadata,
            def.type === "array" ? [...path, "<element>"] : path,
          )
        : valueForMode(metadata, def.type, path);

    return {
      optional: schemaAllowsOmission(fieldSchema),
      fieldName,
      metadata,
      optionNames,
      repeatable,
      schema: fieldSchema,
      value,
    };
  });
};
