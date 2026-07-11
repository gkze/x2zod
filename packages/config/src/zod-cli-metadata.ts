import type { OptionName } from "@optique/core";
import type { z } from "zod/v4";

import { isRecord } from "./structural";
import { schemaError } from "./zod-cli-errors";
import { innerSchema, isSupportedWrapperType, schemaType } from "./zod-introspection";
import type { ZodSchema } from "./zod-introspection";

export type ZodCLIOptionValueMode = "json-file-map" | "string-array";

export type ZodCLIOptionMetadata = Readonly<{
  description?: string | undefined;
  long?: string | undefined;
  short: string;
  valueMode?: ZodCLIOptionValueMode | undefined;
  valueName?: string | undefined;
}>;

export type ZodCLIOptionFieldMetadata = Readonly<{
  fieldName: string;
  metadata: ZodCLIOptionMetadata;
}>;

export const withCLI = <TSchema extends z.ZodType>(
  schema: TSchema,
  metadata: ZodCLIOptionMetadata,
): TSchema => {
  const existingMetadata = schema.meta();
  return schema.meta({ ...existingMetadata, x2zodCLI: metadata } as never);
};

export const readCLIMetadata = (
  schema: ZodSchema,
  path: readonly string[],
): ZodCLIOptionMetadata => {
  const metadata = schema.meta()?.["x2zodCLI"];
  if (metadata !== undefined) return parseCLIMetadata(metadata, path);

  const type = schemaType(schema, path);
  if (isSupportedWrapperType(type)) return readCLIMetadata(innerSchema(schema, path), path);

  throw schemaError(path, "missing CLI option metadata");
};

export const optionNamesForField = (
  fieldName: string,
  metadata: ZodCLIOptionMetadata,
  path: readonly string[],
): readonly [OptionName, OptionName] => {
  const shortOption = validateOptionName(metadata.short, "short", path);
  const longOption = validateOptionName(
    metadata.long ?? derivedLongOption(fieldName),
    "long",
    path,
  );
  return [shortOption, longOption];
};

const parseCLIMetadata = (value: unknown, path: readonly string[]): ZodCLIOptionMetadata => {
  if (!isRecord(value)) throw schemaError(path, "CLI option metadata must be an object");

  const { description, long, short, valueMode, valueName } = value;
  if (typeof short !== "string")
    throw schemaError(path, "CLI option metadata must include a short option");
  if (description !== undefined && typeof description !== "string")
    throw schemaError(path, "CLI option description must be a string");
  if (long !== undefined && typeof long !== "string")
    throw schemaError(path, "CLI long option must be a string");
  if (valueMode !== undefined && valueMode !== "string-array" && valueMode !== "json-file-map")
    throw schemaError(path, `unsupported CLI option value mode ${formatMetadataValue(valueMode)}`);
  if (valueName !== undefined && typeof valueName !== "string")
    throw schemaError(path, "CLI option value name must be a string");

  return { description, long, short, valueMode, valueName };
};

const validateOptionName = (
  name: string,
  kind: "long" | "short",
  path: readonly string[],
): OptionName => {
  const pattern = kind === "short" ? /^-[A-Za-z0-9]$/u : /^--[A-Za-z][A-Za-z0-9-]*$/u;
  if (!pattern.test(name)) throw schemaError(path, `invalid ${kind} option name ${name}`);
  if (name === "-h" || name === "--help")
    throw schemaError(path, `reserved help option name ${name}`);
  return name as OptionName;
};

const formatMetadataValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "bigint" || typeof value === "number")
    return value.toString();
  return typeof value;
};

const derivedLongOption = (fieldName: string): string => {
  const kebabName = fieldName
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .replaceAll(/[^A-Za-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();

  return `--${kebabName}`;
};
