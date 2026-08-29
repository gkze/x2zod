import { z } from "zod/v4";

import { jsonSchemaDialectSchema, jsonSchemaValueSchema } from "../../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../../src";
import { diagnosticIdentitiesSchema } from "./diagnostic-contract";
import type { DiagnosticIdentities } from "./diagnostic-contract";

export type OfficialSuitePrintRequest = Readonly<{
  dialect: JsonSchemaDialect;
  id: string;
  schema: JsonSchemaValue;
}>;
export type OfficialSuitePrintBatch = Readonly<{ requests: readonly OfficialSuitePrintRequest[] }>;
export type OfficialSuitePrintProgress = Readonly<{ id: string; phase: "compile" | "source_emit" }>;
export type OfficialSuitePrintFailure = Readonly<{
  diagnostics: DiagnosticIdentities;
  id: string;
  ok: false;
}>;
export type OfficialSuitePrintSuccess = Readonly<{ id: string; ok: true; source: string }>;
export type OfficialSuitePrintResult = OfficialSuitePrintFailure | OfficialSuitePrintSuccess;
export type OfficialSuitePrintBatchResult = Readonly<{
  results: readonly OfficialSuitePrintResult[];
}>;

const officialSuitePrintRequestSchema: z.ZodType<OfficialSuitePrintRequest> = z
  .object({
    dialect: jsonSchemaDialectSchema,
    id: z.string().min(1),
    schema: jsonSchemaValueSchema,
  })
  .strict();

export const officialSuitePrintBatchSchema: z.ZodType<OfficialSuitePrintBatch> = z
  .object({ requests: z.array(officialSuitePrintRequestSchema) })
  .strict();

export const officialSuitePrintProgressSchema: z.ZodType<OfficialSuitePrintProgress> = z
  .object({ id: z.string().min(1), phase: z.enum(["compile", "source_emit"]) })
  .strict();

const officialSuitePrintFailureSchema: z.ZodType<OfficialSuitePrintFailure> = z
  .object({ diagnostics: diagnosticIdentitiesSchema, id: z.string().min(1), ok: z.literal(false) })
  .strict();

const officialSuitePrintSuccessSchema: z.ZodType<OfficialSuitePrintSuccess> = z
  .object({ id: z.string().min(1), ok: z.literal(true), source: z.string() })
  .strict();

const officialSuitePrintResultSchema: z.ZodType<OfficialSuitePrintResult> = z.union([
  officialSuitePrintFailureSchema,
  officialSuitePrintSuccessSchema,
]);

export const officialSuitePrintBatchResultSchema: z.ZodType<OfficialSuitePrintBatchResult> = z
  .object({ results: z.array(officialSuitePrintResultSchema) })
  .strict();
