import nodePath from "node:path";

import type { z } from "zod/v4";

import { isRecord } from "./structural";
import { schemaError } from "./zod-cli-errors";
import type { ZodCLIOptionValueMode } from "./zod-cli-metadata";
import { zodCLIOptionFieldMetadata } from "./zod-to-optique";
import type { ZodCLIOptionMetadata } from "./zod-to-optique";

type ZodSchema = z.ZodType;
type ResolveModeOverrideRequest = Readonly<{
  context: ZodCLIOptionTransformContext;
  path: readonly string[];
  value: unknown;
}>;
type MergeModeOverrideRequest = Readonly<{ existingValue: unknown; overrideValue: unknown }>;
type ZodCLIOptionValueModeHandler = Readonly<{
  merge?: ((request: MergeModeOverrideRequest) => unknown) | undefined;
  resolve: (request: ResolveModeOverrideRequest) => Promise<unknown>;
}>;

export type ZodCLIOptionTransformContext = Readonly<{
  baseDirectory: string;
  readTextFile: (filePath: string) => Promise<string>;
}>;

export type MergeZodCLIOptionOverridesRequest = Readonly<{
  context: ZodCLIOptionTransformContext;
  existingOptions: unknown;
  overrides: Readonly<Record<string, unknown>>;
  schema: ZodSchema;
}>;

const cliFileMapSeparator = "=";

const fieldMetadataByName = (schema: ZodSchema): ReadonlyMap<string, ZodCLIOptionMetadata> =>
  new Map(
    zodCLIOptionFieldMetadata(schema).map(({ fieldName, metadata }) => [fieldName, metadata]),
  );

const stripUndefinedProperties = (
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value))
    if (fieldValue !== undefined) result[key] = fieldValue;

  return result;
};

const readRepeatableStringValues = (value: unknown, path: readonly string[]): readonly string[] => {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  throw schemaError(path, "expected repeatable string option values");
};

const parseFileMapEntry = (entry: string, path: readonly string[]): readonly [string, string] => {
  const separatorIndex = entry.indexOf(cliFileMapSeparator);
  if (separatorIndex <= 0 || separatorIndex === entry.length - 1)
    throw schemaError(path, "expected ID=FILE option values");

  return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
};

const loadJsonFileMapEntry = async (
  entry: string,
  path: readonly string[],
  context: ZodCLIOptionTransformContext,
): Promise<readonly [string, unknown]> => {
  const [id, filePath] = parseFileMapEntry(entry, path);
  const text = await context.readTextFile(nodePath.resolve(context.baseDirectory, filePath));
  return [id, JSON.parse(text) as unknown];
};

const loadJsonFileMap = async ({
  context,
  path,
  value,
}: ResolveModeOverrideRequest): Promise<Readonly<Record<string, unknown>>> => {
  const entries = readRepeatableStringValues(value, path);
  const loadedEntries = await Promise.all(
    entries.map(async (entry) => {
      const loadedEntry = await loadJsonFileMapEntry(entry, path, context);
      return loadedEntry;
    }),
  );
  return Object.fromEntries(loadedEntries);
};

const mergeRecordValues = ({ existingValue, overrideValue }: MergeModeOverrideRequest): unknown =>
  isRecord(existingValue) && isRecord(overrideValue)
    ? { ...existingValue, ...overrideValue }
    : overrideValue;

const optionValueModeHandlers: Record<ZodCLIOptionValueMode, ZodCLIOptionValueModeHandler> = {
  "json-file-map": { merge: mergeRecordValues, resolve: loadJsonFileMap },
  "string-array": {
    resolve: async ({ path, value }) => {
      await Promise.resolve();
      return readRepeatableStringValues(value, path);
    },
  },
};

const resolveModeOverride = async (
  metadata: ZodCLIOptionMetadata | undefined,
  request: ResolveModeOverrideRequest,
): Promise<unknown> => {
  if (metadata?.valueMode === undefined) {
    await Promise.resolve();
    return request.value;
  }
  const resolved = await optionValueModeHandlers[metadata.valueMode].resolve(request);
  return resolved;
};

export const resolveZodCLIOptionOverrides = async (
  schema: ZodSchema,
  overrides: Readonly<Record<string, unknown>>,
  context: ZodCLIOptionTransformContext,
): Promise<Readonly<Record<string, unknown>>> => {
  const metadataByField = fieldMetadataByName(schema);
  const entries = await Promise.all(
    Object.entries(overrides).map(
      async ([fieldName, value]): Promise<readonly [string, unknown]> => {
        const metadata = metadataByField.get(fieldName);
        const resolved = await resolveModeOverride(metadata, { context, path: [fieldName], value });
        return [fieldName, resolved];
      },
    ),
  );

  return stripUndefinedProperties(Object.fromEntries(entries));
};

export const mergeZodCLIOptionOverrides = async ({
  context,
  existingOptions,
  overrides,
  schema,
}: MergeZodCLIOptionOverridesRequest): Promise<unknown> => {
  const resolvedOverrides = await resolveZodCLIOptionOverrides(schema, overrides, context);
  if (!isRecord(existingOptions)) return resolvedOverrides;

  const metadataByField = fieldMetadataByName(schema);
  const merged: Record<string, unknown> = { ...existingOptions, ...resolvedOverrides };
  for (const [fieldName, metadata] of metadataByField)
    if (metadata.valueMode !== undefined) {
      const overrideValue = resolvedOverrides[fieldName];
      if (overrideValue !== undefined) {
        const modeHandler = optionValueModeHandlers[metadata.valueMode];
        merged[fieldName] =
          modeHandler.merge?.({ existingValue: existingOptions[fieldName], overrideValue }) ??
          overrideValue;
      }
    }

  return merged;
};
