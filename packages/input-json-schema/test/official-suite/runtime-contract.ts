import type { JsonValue } from "type-fest";
import { z } from "zod/v4";

import type { NonEmptyReadonlyArray } from "@x2zod/core";

export type OfficialSuiteRuntimeCaseRequest = Readonly<{
  data: JsonValue;
  expectedValid: boolean;
  id: string;
}>;
export type OfficialSuiteRuntimeGroupRequest = Readonly<{
  cases: readonly OfficialSuiteRuntimeCaseRequest[];
  generatedFile: string;
  id: string;
}>;
export type OfficialSuiteRuntimeBatch = Readonly<{
  groups: readonly OfficialSuiteRuntimeGroupRequest[];
}>;
export type OfficialSuiteRuntimeProgress = Readonly<{
  id: string;
  phase: "module_import" | "runtime";
}>;
export type RuntimeGapCode = "input_mutation" | "parse_identity_mismatch" | "validity_mismatch";
export type RuntimeGapContract = Readonly<{
  codes: NonEmptyReadonlyArray<RuntimeGapCode>;
  id: string;
  phase: "runtime";
}>;
export type RuntimeParseResult =
  | Readonly<{ data: unknown; success: true }>
  | Readonly<{ success: false }>;
export type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;
export type OfficialSuiteRuntimeCaseResult =
  | Readonly<{ id: string; ok: true }>
  | Readonly<RuntimeGapContract & { ok: false }>;
export type OfficialSuiteRuntimeBatchResult = Readonly<{
  results: readonly OfficialSuiteRuntimeCaseResult[];
}>;

const preservingJsonValueSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
  (value) => z.json().safeParse(value).success,
);

const officialSuiteRuntimeCaseRequestSchema: z.ZodType<OfficialSuiteRuntimeCaseRequest> = z
  .object({ data: preservingJsonValueSchema, expectedValid: z.boolean(), id: z.string().min(1) })
  .strict();

const officialSuiteRuntimeGroupRequestSchema: z.ZodType<OfficialSuiteRuntimeGroupRequest> = z
  .object({
    cases: z.array(officialSuiteRuntimeCaseRequestSchema).min(1),
    generatedFile: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

export const officialSuiteRuntimeBatchSchema: z.ZodType<OfficialSuiteRuntimeBatch> = z
  .object({ groups: z.array(officialSuiteRuntimeGroupRequestSchema).min(1) })
  .strict();

export const officialSuiteRuntimeProgressSchema: z.ZodType<OfficialSuiteRuntimeProgress> = z
  .object({ id: z.string().min(1), phase: z.enum(["module_import", "runtime"]) })
  .strict();

export const runtimeGapCodeSchema: z.ZodType<RuntimeGapCode> = z.enum([
  "input_mutation",
  "parse_identity_mismatch",
  "validity_mismatch",
]);
const officialSuiteRuntimeCaseResultSchema: z.ZodType<OfficialSuiteRuntimeCaseResult> =
  z.discriminatedUnion("ok", [
    z.object({ id: z.string().min(1), ok: z.literal(true) }).strict(),
    z
      .object({
        codes: z.tuple([runtimeGapCodeSchema], runtimeGapCodeSchema),
        id: z.string().min(1),
        ok: z.literal(false),
        phase: z.literal("runtime"),
      })
      .strict(),
  ]);

export const officialSuiteRuntimeBatchResultSchema: z.ZodType<OfficialSuiteRuntimeBatchResult> = z
  .object({ results: z.array(officialSuiteRuntimeCaseResultSchema) })
  .strict();
