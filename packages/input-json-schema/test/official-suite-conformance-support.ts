import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { isDeepStrictEqual } from "node:util";

import AjvDraft7 from "ajv";
import type { Options, ValidateFunction } from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";
import { z } from "zod/v4";

import { diagnosticSeveritySchema, jsonPointerSchema } from "@x2zod/core";
import type { DiagnosticSeverity, JsonPointer } from "@x2zod/core";

import { jsonSchemaValueSchema } from "../src";
import type { JsonSchemaDialect, JsonSchemaValue } from "../src";

const sortBefore = -1;
const sortEqual = 0;
const sortAfter = 1;
const officialSuiteRemoteBaseUri = "http://localhost:1234/";
const ajvOptions = {
  allErrors: true,
  logger: false,
  strict: false,
  validateSchema: false,
} satisfies Options;

type DiagnosticIdentityInput = Readonly<{
  code: string;
  message: string;
  pointer: string | null;
  severity: DiagnosticSeverity;
}>;
export type DiagnosticIdentity = Readonly<{
  code: string;
  message: string;
  pointer: JsonPointer | null;
  severity: DiagnosticSeverity;
}>;

export const diagnosticIdentitySchema: z.ZodType<DiagnosticIdentity, DiagnosticIdentityInput> = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    pointer: jsonPointerSchema.nullable(),
    severity: diagnosticSeveritySchema,
  })
  .strict();

export type OfficialSuiteExternalSchemas = Readonly<Record<string, JsonSchemaValue>>;
export type RuntimeParseResult =
  | Readonly<{ data: unknown; success: true }>
  | Readonly<{ success: false }>;
export type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;
export type CompileGapContract = Readonly<{
  diagnostics: readonly DiagnosticIdentity[];
  id: string;
  phase: "compile";
}>;
export type RuntimeGapContract = Readonly<{
  codes: readonly string[];
  id: string;
  phase: "runtime";
}>;
export type GapContract = CompileGapContract | RuntimeGapContract;
export type ObservedGap =
  | (CompileGapContract & Readonly<{ detail: string }>)
  | (RuntimeGapContract & Readonly<{ detail: string }>);

type CreateObservedGapRequest =
  | (CompileGapContract & Readonly<{ detail: string }>)
  | (RuntimeGapContract & Readonly<{ detail: string }>);
type GapContractDiff = Readonly<{
  missing: readonly GapContract[];
  unexpected: readonly GapContract[];
}>;
type RuntimeGapRequest = Readonly<{
  data: unknown;
  expectedValid: boolean;
  id: string;
  schema: RuntimeZodSchema;
}>;

export const parseDiagnosticIdentity = (
  input: z.input<typeof diagnosticIdentitySchema>,
): DiagnosticIdentity => diagnosticIdentitySchema.parse(input);

const compareText = (left: string, right: string): number => {
  if (left === right) return sortEqual;
  return left < right ? sortBefore : sortAfter;
};

const listJsonFiles = async (directory: string): Promise<readonly string[]> => {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const entries = directoryEntries.toSorted((left, right) => compareText(left.name, right.name));
  const nestedFiles = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const entryPath = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        const files = await listJsonFiles(entryPath);
        return files;
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    }),
  );
  return nestedFiles.flat();
};

const officialSuiteRemoteUri = (suiteRemotesDirectory: string, file: string): string =>
  new URL(
    nodePath.relative(suiteRemotesDirectory, file).split(nodePath.sep).join("/"),
    officialSuiteRemoteBaseUri,
  ).href;

export const loadOfficialSuiteExternalSchemas = async (
  suiteRemotesDirectory: string,
): Promise<OfficialSuiteExternalSchemas> => {
  const files = await listJsonFiles(suiteRemotesDirectory);
  const entries = await Promise.all(
    files.map(
      async (file) =>
        [
          officialSuiteRemoteUri(suiteRemotesDirectory, file),
          jsonSchemaValueSchema.parse(JSON.parse(await readFile(file, "utf8"))),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
};

const canonicalDiagnosticIdentity = ({
  code,
  message,
  pointer,
  severity,
}: DiagnosticIdentity): DiagnosticIdentity => ({ code, message, pointer, severity });

const diagnosticIdentityKey = (diagnostic: DiagnosticIdentity): string =>
  JSON.stringify(canonicalDiagnosticIdentity(diagnostic));

const canonicalGapContract = (gap: GapContract): GapContract =>
  gap.phase === "compile"
    ? {
        diagnostics: gap.diagnostics
          .map((diagnostic) => canonicalDiagnosticIdentity(diagnostic))
          .toSorted((left, right) =>
            compareText(diagnosticIdentityKey(left), diagnosticIdentityKey(right)),
          ),
        id: gap.id,
        phase: gap.phase,
      }
    : { codes: [...gap.codes].toSorted(), id: gap.id, phase: gap.phase };

const gapContractKey = (gap: GapContract): string => JSON.stringify(canonicalGapContract(gap));

export const gapContractDiff = (
  observed: readonly GapContract[],
  expected: readonly GapContract[],
): GapContractDiff => {
  const observedKeys = new Set(observed.map((gap) => gapContractKey(gap)));
  const expectedKeys = new Set(expected.map((gap) => gapContractKey(gap)));
  return {
    missing: expected
      .filter((gap) => !observedKeys.has(gapContractKey(gap)))
      .map((gap) => canonicalGapContract(gap)),
    unexpected: observed
      .filter((gap) => !expectedKeys.has(gapContractKey(gap)))
      .map((gap) => canonicalGapContract(gap)),
  };
};

export const observedGap = (request: CreateObservedGapRequest): ObservedGap =>
  request.phase === "compile"
    ? {
        ...canonicalGapContract({
          diagnostics: request.diagnostics,
          id: request.id,
          phase: request.phase,
        }),
        detail: request.detail,
      }
    : {
        ...canonicalGapContract({ codes: request.codes, id: request.id, phase: request.phase }),
        detail: request.detail,
      };

const parseRuntimeSchema = (
  schema: RuntimeZodSchema,
  value: unknown,
  id: string,
): RuntimeParseResult => {
  try {
    return schema.safeParse(value);
  } catch (error) {
    throw new Error(`Generated schema runtime failed for official suite case ${id}.`, {
      cause: error,
    });
  }
};

export const runtimeGap = ({
  data,
  expectedValid,
  id,
  schema,
}: RuntimeGapRequest): ObservedGap | undefined => {
  const inputBaseline = structuredClone(data);
  const parseInput = structuredClone(data);

  const parsed = parseRuntimeSchema(schema, parseInput, id);
  if (!isDeepStrictEqual(parseInput, inputBaseline))
    return observedGap({
      codes: ["input_mutation"],
      detail: "schema mutated input during parsing",
      id,
      phase: "runtime",
    });
  if (parsed.success !== expectedValid)
    return observedGap({
      codes: ["validity_mismatch"],
      detail:
        `expected valid=${expectedValid.toString()}, ` +
        `received success=${parsed.success.toString()}`,
      id,
      phase: "runtime",
    });
  if (parsed.success && !isDeepStrictEqual(parsed.data, inputBaseline))
    return observedGap({
      codes: ["parse_identity_mismatch"],
      detail: "valid input was transformed instead of preserving JSON identity",
      id,
      phase: "runtime",
    });
  return undefined;
};

export const createOfficialSuiteValidator = (
  dialect: JsonSchemaDialect,
  schema: JsonSchemaValue,
  externalSchemas: OfficialSuiteExternalSchemas,
): ValidateFunction => {
  const options = { ...ajvOptions, schemas: externalSchemas } satisfies Options;
  if (dialect === "draft-7") return new AjvDraft7(options).compile(schema);
  if (dialect === "draft-2019-09") return new AjvDraft2019(options).compile(schema);
  return new AjvDraft2020(options).compile(schema);
};
