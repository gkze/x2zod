import { z } from "zod/v4";

import { diagnosticCodeSchema, diagnosticSeveritySchema, jsonPointerSchema } from "@x2zod/core";
import type {
  DiagnosticCode,
  DiagnosticSeverity,
  JsonPointer,
  NonEmptyReadonlyArray,
} from "@x2zod/core";

type DiagnosticIdentityInput = Readonly<{
  code: string;
  message: string;
  pointer: string | null;
  severity: DiagnosticSeverity;
}>;
export type DiagnosticIdentity = Readonly<{
  code: DiagnosticCode;
  message: string;
  pointer: JsonPointer | null;
  severity: DiagnosticSeverity;
}>;
export type DiagnosticIdentities = NonEmptyReadonlyArray<DiagnosticIdentity>;
type DiagnosticIdentitiesInput = NonEmptyReadonlyArray<DiagnosticIdentityInput>;

export const diagnosticIdentitySchema: z.ZodType<DiagnosticIdentity, DiagnosticIdentityInput> = z
  .object({
    code: diagnosticCodeSchema,
    message: z.string().min(1),
    pointer: jsonPointerSchema.nullable(),
    severity: diagnosticSeveritySchema,
  })
  .strict();

export const diagnosticIdentitiesSchema: z.ZodType<
  DiagnosticIdentities,
  DiagnosticIdentitiesInput
> = z.tuple([diagnosticIdentitySchema], diagnosticIdentitySchema);

export const parseDiagnosticIdentity = (
  input: z.input<typeof diagnosticIdentitySchema>,
): DiagnosticIdentity => diagnosticIdentitySchema.parse(input);
