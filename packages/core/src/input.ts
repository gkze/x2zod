import { z } from "zod/v4";

import { createDiagnostic, formatZodError } from "./diagnostics";
import type { JsonPointer, SourceSpan } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { ZodEmissionModuleInput } from "./zod-plan";

const nonEmptyStringLength = 1;

export type FileInputDocumentSource = Readonly<{ kind: "file"; path: string }>;
export type InlineInputDocumentSource = Readonly<{ id: string; kind: "inline" }>;
export type UriInputDocumentSource = Readonly<{ kind: "uri"; uri: string }>;
export type InputDocumentSource =
  | FileInputDocumentSource
  | InlineInputDocumentSource
  | UriInputDocumentSource;
export type InputDocument = Readonly<{
  source: InputDocumentSource;
  text: string;
  mediaType?: string;
}>;
export type InputDocumentInput = InputDocument;

const fileInputDocumentSourceSchema: z.ZodType<FileInputDocumentSource, FileInputDocumentSource> = z
  .strictObject({ kind: z.literal("file"), path: z.string().min(nonEmptyStringLength) })
  .readonly();
const inlineInputDocumentSourceSchema: z.ZodType<
  InlineInputDocumentSource,
  InlineInputDocumentSource
> = z
  .strictObject({ kind: z.literal("inline"), id: z.string().min(nonEmptyStringLength) })
  .readonly();
const uriInputDocumentSourceSchema: z.ZodType<UriInputDocumentSource, UriInputDocumentSource> = z
  .strictObject({ kind: z.literal("uri"), uri: z.url() })
  .readonly();

const inputDocumentSourceSchemaValue: z.ZodType<InputDocumentSource, InputDocumentSource> = z.union(
  [fileInputDocumentSourceSchema, inlineInputDocumentSourceSchema, uriInputDocumentSourceSchema],
);
export const inputDocumentSourceSchema: z.ZodType<InputDocumentSource, InputDocumentSource> =
  inputDocumentSourceSchemaValue;

const inputDocumentSchemaValue: z.ZodType<InputDocument, InputDocumentInput> = z
  .strictObject({
    source: inputDocumentSourceSchemaValue,
    text: z.string(),
    mediaType: z.string().min(nonEmptyStringLength).exactOptional(),
  })
  .readonly();
export const inputDocumentSchema: z.ZodType<InputDocument, InputDocumentInput> =
  inputDocumentSchemaValue;

export type SourceLocationMap = ReadonlyMap<JsonPointer, SourceSpan>;

export type PreparedInput<TInput> = Readonly<{ value: TInput; locations?: SourceLocationMap }>;

export type PluginOptionsSchema<TOptions, TOptionsInput = TOptions> = z.ZodType<
  TOptions,
  TOptionsInput
>;

export type InputPlugin<
  TPreparedInput,
  TOptions,
  TOptionsInput = TOptions,
  TKind extends string = string,
> = Readonly<{
  kind: TKind;
  optionsSchema: PluginOptionsSchema<TOptions, TOptionsInput>;
  prepare: (
    document: InputDocument,
    options: TOptions,
  ) => Promise<Result<PreparedInput<TPreparedInput>>>;
  lower: (
    input: PreparedInput<TPreparedInput>,
    options: TOptions,
  ) => Promise<Result<ZodEmissionModuleInput>>;
}>;

export const parseInputDocument = (document: InputDocumentInput): Result<InputDocument> => {
  const parsed = inputDocumentSchemaValue.safeParse(document);
  return parsed.success
    ? ok(parsed.data)
    : err(
        createDiagnostic({
          code: "invalid_input_document",
          message: `Input document is invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};
