import type { JsonValue } from "type-fest";
import { z } from "zod/v4";

export const buildInputFormats = ["json", "markdown", "text"] as const;
export const buildInputArchiveFormats = ["tar", "tar.gz", "zip"] as const;
export const buildInputsModes = ["check", "materialize", "update-lock"] as const;

const buildInputIdPattern = /^[a-z0-9][a-z0-9-]*$/u;
const globPatternSchema = z.string().min(1);

const canParseSha256Hex = (value: string): boolean => {
  if (value.length !== 64 || value !== value.toLowerCase()) return false;

  const bytes = Buffer.from(value, "hex");

  return bytes.length === 32 && bytes.toString("hex") === value;
};

export const jsonValueSchema: z.ZodType<JsonValue> = z.json();
export const buildInputFormatSchema = z.enum(buildInputFormats);
export const buildInputArchiveFormatSchema = z.enum(buildInputArchiveFormats);
export const buildInputsModeSchema = z.enum(buildInputsModes);
export const buildInputIdSchema = z
  .string()
  .regex(buildInputIdPattern, {
    message:
      "Build input ids must start with a lowercase ASCII letter or digit " +
      "and contain only lowercase ASCII letters, digits, and hyphens",
  })
  .brand<"BuildInputId">();
export const sha256HexSchema = z
  .string()
  .refine(canParseSha256Hex, { message: "Expected a lowercase hex-encoded SHA-256 digest" })
  .brand<"Sha256Hex">();

export const buildInputFileDeclarationSchema = z
  .object({
    format: buildInputFormatSchema.optional(),
    id: buildInputIdSchema,
    path: z.string().min(1),
    type: z.literal("file").optional(),
    url: z.url(),
  })
  .strict();

export const buildInputArchiveUnpackDeclarationSchema = z
  .object({
    directory: z.string().min(1),
    exclude: z.array(globPatternSchema).default([]),
    include: z.array(globPatternSchema).default([]),
    stripComponents: z.number().int().nonnegative().default(0),
  })
  .strict();

export const buildInputArchiveDeclarationSchema = z
  .object({
    archiveFormat: buildInputArchiveFormatSchema,
    id: buildInputIdSchema,
    type: z.literal("archive"),
    unpack: buildInputArchiveUnpackDeclarationSchema,
    url: z.url(),
  })
  .strict();

export const buildInputDeclarationSchema = z.union([
  buildInputArchiveDeclarationSchema,
  buildInputFileDeclarationSchema,
]);

export const buildInputsDeclarationSchema = z
  .object({
    $schema: z.string().min(1).optional(),
    inputs: z.array(buildInputDeclarationSchema).min(1),
    version: z.literal(1),
  })
  .strict();

export const buildInputsLockEntrySchema = z
  .object({ sha256: sha256HexSchema, sizeBytes: z.number().int().nonnegative() })
  .strict();

export const buildInputArchiveLockEntrySchema = z
  .object({
    materialization: z.object({ sha256: sha256HexSchema }).strict(),
    materialized: z
      .object({
        directoryCount: z.number().int().nonnegative(),
        fileCount: z.number().int().nonnegative(),
        sha256: sha256HexSchema,
        totalSizeBytes: z.number().int().nonnegative(),
      })
      .strict(),
    source: buildInputsLockEntrySchema.extend({ url: z.url() }),
    type: z.literal("archive"),
  })
  .strict();

export const buildInputsLockSchema = z
  .object({
    inputs: z.record(buildInputIdSchema, buildInputArchiveLockEntrySchema).optional(),
    urls: z.record(z.url(), buildInputsLockEntrySchema),
    version: z.literal(1),
  })
  .strict();

export const buildInputsOptionsSchema = z
  .object({
    configPath: z.string().min(1).optional(),
    ids: z.array(buildInputIdSchema).optional(),
    lockfilePath: z.string().min(1).optional(),
    mode: buildInputsModeSchema.default("materialize"),
    rootDir: z.string().min(1).optional(),
  })
  .strict();

export const resolvedBuildInputFileSchema = buildInputFileDeclarationSchema
  .extend({ absolutePath: z.string().min(1) })
  .strict();

export const resolvedBuildInputArchiveSchema = buildInputArchiveDeclarationSchema
  .extend({ absoluteDirectory: z.string().min(1) })
  .strict();

export const resolvedBuildInputSchema = z.union([
  resolvedBuildInputArchiveSchema,
  resolvedBuildInputFileSchema,
]);

export const archiveMaterializationRecipeSchema = buildInputArchiveDeclarationSchema
  .pick({ archiveFormat: true, unpack: true })
  .extend({ type: z.literal("archive") });

export const buildInputFileResultSchema = z
  .object({
    id: buildInputIdSchema,
    path: z.string().min(1),
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
    type: z.literal("file").optional(),
    url: z.url(),
  })
  .strict();

export const buildInputArchiveResultSchema = z
  .object({
    id: buildInputIdSchema,
    materializationSha256: sha256HexSchema,
    path: z.string().min(1),
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
    sourceSha256: sha256HexSchema,
    sourceSizeBytes: z.number().int().nonnegative(),
    totalSizeBytes: z.number().int().nonnegative(),
    type: z.literal("archive"),
    url: z.url(),
  })
  .strict();

export const buildInputResultSchema = z.union([
  buildInputArchiveResultSchema,
  buildInputFileResultSchema,
]);

export const buildInputsResultSchema = z
  .object({
    inputs: z.array(buildInputResultSchema),
    lockfilePath: z.string().min(1),
    lockfileUpdated: z.boolean(),
    mode: buildInputsModeSchema,
  })
  .strict();

export const downloadedBuildInputSchema = z
  .object({
    content: z.string(),
    input: resolvedBuildInputFileSchema,
    sha256: sha256HexSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export type BuildInputId = z.infer<typeof buildInputIdSchema>;
export type BuildInputFormat = z.infer<typeof buildInputFormatSchema>;
export type BuildInputArchiveFormat = z.infer<typeof buildInputArchiveFormatSchema>;
export type BuildInputsMode = z.infer<typeof buildInputsModeSchema>;
export type Sha256Hex = z.infer<typeof sha256HexSchema>;
export type BuildInputArchiveDeclaration = z.infer<typeof buildInputArchiveDeclarationSchema>;
export type BuildInputArchiveUnpackDeclaration = z.infer<
  typeof buildInputArchiveUnpackDeclarationSchema
>;
export type BuildInputDeclaration = z.infer<typeof buildInputDeclarationSchema>;
export type BuildInputFileDeclaration = z.infer<typeof buildInputFileDeclarationSchema>;
export type BuildInputsDeclaration = z.infer<typeof buildInputsDeclarationSchema>;
export type BuildInputArchiveLockEntry = z.infer<typeof buildInputArchiveLockEntrySchema>;
export type BuildInputsLockEntry = z.infer<typeof buildInputsLockEntrySchema>;
export type BuildInputsLock = z.infer<typeof buildInputsLockSchema>;
export type BuildInputsOptions = z.input<typeof buildInputsOptionsSchema>;
export type ResolvedBuildInputArchive = z.infer<typeof resolvedBuildInputArchiveSchema>;
export type ResolvedBuildInputFile = z.infer<typeof resolvedBuildInputFileSchema>;
export type ResolvedBuildInput = z.infer<typeof resolvedBuildInputSchema>;
export type ArchiveMaterializationRecipe = z.infer<typeof archiveMaterializationRecipeSchema>;
export type DownloadedBuildInput = z.infer<typeof downloadedBuildInputSchema>;
export type BuildInputResult = z.infer<typeof buildInputResultSchema>;
export type BuildInputsResult = z.infer<typeof buildInputsResultSchema>;
