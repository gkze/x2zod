import { createHash } from "node:crypto";
import nodePath from "node:path";

import { z } from "zod/v4";

import type { NonEmptyReadonlyArray } from "@x2zod/core";

import { jsonSchemaDialectSchema } from "../../src";
import type { JsonSchemaDialect } from "../../src";
import { diagnosticIdentitiesSchema } from "./diagnostic-contract";
import type { DiagnosticIdentities, DiagnosticIdentity } from "./diagnostic-contract";
import {
  fixtureDirectory,
  groupId,
  hashCaseInventory,
  officialSuiteDialects,
  selectedCaseIds,
} from "./fixture-support";
import type { SelectedGroup } from "./fixture-support";
import { runtimeGapCodeSchema } from "./runtime-contract";
import type { RuntimeGapCode, RuntimeGapContract } from "./runtime-contract";

type BaselineSummary = Readonly<{
  compileGapCaseCount: number;
  compileGapGroupCount: number;
  conformingCaseCount: number;
  gapCaseInventorySha256: string;
  oracleDiscrepancyCount: number;
  passingCaseInventorySha256: string;
  runtimeGapCaseCount: number;
}>;
type DialectBaselineSummary = BaselineSummary &
  Readonly<{ dialect: JsonSchemaDialect; testCount: number }>;
type OracleRuntimeGapCode = "input_mutation" | "runtime_exception" | "validity_mismatch";
type BaselineOracleGaps = Readonly<{
  compile: Readonly<Record<string, "compile_exception">>;
  runtime: Readonly<Record<string, NonEmptyReadonlyArray<OracleRuntimeGapCode>>>;
}>;
export type OracleGap =
  | Readonly<{ code: "compile_exception"; id: string; phase: "compile" }>
  | Readonly<{ code: OracleRuntimeGapCode; id: string; phase: "runtime" }>;
export type OfficialSuiteBaseline = Readonly<{
  byDialect: readonly DialectBaselineSummary[];
  caseCount: number;
  caseInventorySha256: string;
  compileDiagnosticSets: Readonly<Record<string, DiagnosticIdentities>>;
  compileGaps: Readonly<Record<string, string>>;
  oracleGaps: BaselineOracleGaps;
  runtimeGaps: Readonly<Record<string, NonEmptyReadonlyArray<RuntimeGapCode>>>;
  suiteCommit: string;
  summary: BaselineSummary;
  version: 1;
}>;
export type OfficialSuiteBaselineDiffOptions = Readonly<{
  describeId?: ((id: string) => string | undefined) | undefined;
}>;

const sortBefore = -1;
const sortEqual = 0;
const sortAfter = 1;
const oracleRuntimeGapCodeSchema: z.ZodType<OracleRuntimeGapCode> = z.enum([
  "input_mutation",
  "runtime_exception",
  "validity_mismatch",
]);
const countSchema = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const compareText = (left: string, right: string): number => {
  if (left === right) return sortEqual;
  return left < right ? sortBefore : sortAfter;
};

const canonicalDiagnostic = ({
  code,
  message,
  pointer,
  severity,
}: DiagnosticIdentity): DiagnosticIdentity => ({ code, message, pointer, severity });

const canonicalDiagnostics = (diagnostics: DiagnosticIdentities): DiagnosticIdentities =>
  diagnosticIdentitiesSchema.parse(
    diagnostics
      .map((diagnostic) => canonicalDiagnostic(diagnostic))
      .toSorted((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
  );

const hashJson = (value: unknown): string =>
  createHash("sha256")
    .update(`${JSON.stringify(value)}\n`)
    .digest("hex");

const baselineSummarySchema = z
  .object({
    compileGapCaseCount: countSchema,
    compileGapGroupCount: countSchema,
    conformingCaseCount: countSchema,
    gapCaseInventorySha256: sha256Schema,
    oracleDiscrepancyCount: countSchema,
    passingCaseInventorySha256: sha256Schema,
    runtimeGapCaseCount: countSchema,
  })
  .strict();
const dialectBaselineSummarySchema = baselineSummarySchema
  .extend({ dialect: jsonSchemaDialectSchema, testCount: countSchema })
  .strict();
const compileGapsSchema = z.record(z.string().min(1), sha256Schema);
const runtimeGapCodesSchema = z.tuple([runtimeGapCodeSchema], runtimeGapCodeSchema);
const runtimeGapsSchema = z.record(z.string().min(1), runtimeGapCodesSchema);
const oracleRuntimeGapCodesSchema = z.tuple(
  [oracleRuntimeGapCodeSchema],
  oracleRuntimeGapCodeSchema,
);
const oracleGapsSchema = z
  .object({
    compile: z.record(z.string().min(1), z.literal("compile_exception")),
    runtime: z.record(z.string().min(1), oracleRuntimeGapCodesSchema),
  })
  .strict();

const officialSuiteBaselineShapeSchema = z
  .object({
    byDialect: z.array(dialectBaselineSummarySchema).length(officialSuiteDialects.length),
    caseCount: countSchema,
    caseInventorySha256: sha256Schema,
    compileDiagnosticSets: z.record(sha256Schema, diagnosticIdentitiesSchema),
    compileGaps: compileGapsSchema,
    oracleGaps: oracleGapsSchema,
    runtimeGaps: runtimeGapsSchema,
    suiteCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    summary: baselineSummarySchema,
    version: z.literal(1),
  })
  .strict();

export const officialSuiteBaselineSchema: z.ZodType<OfficialSuiteBaseline> =
  officialSuiteBaselineShapeSchema.superRefine((baseline, context) => {
    const dialects = baseline.byDialect.map((summary) => summary.dialect);
    if (new Set(dialects).size !== dialects.length)
      context.addIssue({
        code: "custom",
        message: "Dialect summaries must be unique.",
        path: ["byDialect"],
      });

    for (const [id, codes] of Object.entries(baseline.runtimeGaps))
      if (new Set(codes).size !== codes.length)
        context.addIssue({
          code: "custom",
          message: "Runtime gap codes must be unique.",
          path: ["runtimeGaps", id],
        });
    for (const [id, codes] of Object.entries(baseline.oracleGaps.runtime))
      if (new Set(codes).size !== codes.length)
        context.addIssue({
          code: "custom",
          message: "Oracle runtime gap codes must be unique.",
          path: ["oracleGaps", "runtime", id],
        });

    const referencedDiagnosticSets = new Set(Object.values(baseline.compileGaps));
    for (const [id, diagnosticSetSha256] of Object.entries(baseline.compileGaps))
      if (baseline.compileDiagnosticSets[diagnosticSetSha256] === undefined)
        context.addIssue({
          code: "custom",
          message: `Unknown compile diagnostic set ${diagnosticSetSha256}.`,
          path: ["compileGaps", id],
        });
    for (const [sha256, diagnostics] of Object.entries(baseline.compileDiagnosticSets)) {
      if (sha256 !== hashJson(canonicalDiagnostics(diagnostics)))
        context.addIssue({
          code: "custom",
          message: "Compile diagnostic set hash does not match its canonical contents.",
          path: ["compileDiagnosticSets", sha256],
        });
      if (!referencedDiagnosticSets.has(sha256))
        context.addIssue({
          code: "custom",
          message: "Compile diagnostic set is not referenced by a compile gap.",
          path: ["compileDiagnosticSets", sha256],
        });
    }
  });

export const officialSuiteBaselineFile: string = nodePath.join(
  fixtureDirectory,
  "official-suite-baseline.json",
);

export type ObservedCompileGap = Readonly<{ diagnostics: DiagnosticIdentities; id: string }>;
type BuildOfficialSuiteBaselineRequest = Readonly<{
  compileGaps: readonly ObservedCompileGap[];
  groups: readonly SelectedGroup[];
  oracleGaps: readonly OracleGap[];
  runtimeGaps: readonly RuntimeGapContract[];
  suiteCommit: string;
}>;

const requireUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
};

const sortedNonEmptyText = <TValue extends string>(
  values: NonEmptyReadonlyArray<TValue>,
): NonEmptyReadonlyArray<TValue> => {
  const [first, ...remaining] = [...values].toSorted(compareText);
  if (first === undefined) throw new Error("Expected at least one value.");
  return [first, ...remaining];
};

const dialectFromId = (id: string): JsonSchemaDialect => {
  const dialect = id.slice(0, id.indexOf(":"));
  return jsonSchemaDialectSchema.parse(dialect);
};

const summaryFor = ({
  caseIds,
  compileGapCaseIds,
  compileGapIds,
  oracleGaps,
  runtimeGapIds,
}: Readonly<{
  caseIds: readonly string[];
  compileGapCaseIds: ReadonlySet<string>;
  compileGapIds: readonly string[];
  oracleGaps: readonly OracleGap[];
  runtimeGapIds: ReadonlySet<string>;
}>): BaselineSummary => {
  const gapCaseIds = caseIds.filter((id) => compileGapCaseIds.has(id) || runtimeGapIds.has(id));
  const passingCaseIds = caseIds.filter(
    (id) => !compileGapCaseIds.has(id) && !runtimeGapIds.has(id),
  );
  return {
    compileGapCaseCount: caseIds.filter((id) => compileGapCaseIds.has(id)).length,
    compileGapGroupCount: compileGapIds.length,
    conformingCaseCount: passingCaseIds.length,
    gapCaseInventorySha256: hashCaseInventory(gapCaseIds),
    oracleDiscrepancyCount: oracleGaps.length,
    passingCaseInventorySha256: hashCaseInventory(passingCaseIds),
    runtimeGapCaseCount: caseIds.filter((id) => runtimeGapIds.has(id)).length,
  };
};

const requireUniqueBuildInputs = (
  request: BuildOfficialSuiteBaselineRequest,
  caseIds: readonly string[],
): void => {
  requireUnique(caseIds, "Official suite case ids");
  requireUnique(
    request.groups.map((group) => groupId(group)),
    "Official suite group ids",
  );
  requireUnique(
    request.compileGaps.map((gap) => gap.id),
    "Compile gap ids",
  );
  requireUnique(
    request.runtimeGaps.map((gap) => gap.id),
    "Runtime gap ids",
  );
  requireUnique(
    request.oracleGaps.map((gap) => `${gap.phase}:${gap.id}:${gap.code}`),
    "Oracle gap identities",
  );
};

const collectCompileGapCaseIds = (
  compileGaps: readonly ObservedCompileGap[],
  groupsById: ReadonlyMap<string, SelectedGroup>,
): ReadonlySet<string> => {
  const caseIds = new Set<string>();
  for (const gap of compileGaps) {
    const group = groupsById.get(gap.id);
    if (group === undefined) throw new Error(`Unknown compile gap group ${gap.id}.`);
    for (const testIndex of group.group.tests.keys())
      caseIds.add(`${gap.id}:${testIndex.toString()}`);
  }
  return caseIds;
};

const collectRuntimeGapIds = (
  runtimeGaps: readonly RuntimeGapContract[],
  caseIds: ReadonlySet<string>,
  compileGapCaseIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const gap of runtimeGaps) {
    if (!caseIds.has(gap.id)) throw new Error(`Unknown runtime gap case ${gap.id}.`);
    if (compileGapCaseIds.has(gap.id))
      throw new Error(`Runtime gap ${gap.id} belongs to a compile-gap group.`);
    ids.add(gap.id);
  }
  return ids;
};

const requireKnownOracleGaps = (
  oracleGaps: readonly OracleGap[],
  groupsById: ReadonlyMap<string, SelectedGroup>,
  caseIds: ReadonlySet<string>,
): void => {
  for (const gap of oracleGaps) {
    const known = gap.phase === "compile" ? groupsById.has(gap.id) : caseIds.has(gap.id);
    if (!known) throw new Error(`Unknown ${gap.phase} oracle gap ${gap.id}.`);
  }
};

type CanonicalOracleBaseline = Readonly<{ events: readonly OracleGap[]; gaps: BaselineOracleGaps }>;

const canonicalOracleBaseline = (
  oracleGaps: readonly OracleGap[],
  groups: readonly SelectedGroup[],
  caseIds: readonly string[],
): CanonicalOracleBaseline => {
  const events = [...oracleGaps].toSorted((left, right) =>
    compareText(
      `${left.phase}:${left.id}:${left.code}`,
      `${right.phase}:${right.id}:${right.code}`,
    ),
  );
  const compileGapIds = new Set(events.flatMap((gap) => (gap.phase === "compile" ? [gap.id] : [])));
  const runtimeGapsById = new Map<string, NonEmptyReadonlyArray<OracleRuntimeGapCode>>();
  const runtimeEvents = events.filter((gap) => gap.phase === "runtime");
  for (const gap of runtimeEvents) {
    const codes = runtimeGapsById.get(gap.id);
    runtimeGapsById.set(
      gap.id,
      codes === undefined ? [gap.code] : [codes[0], ...codes.slice(1), gap.code],
    );
  }
  return {
    events,
    gaps: {
      compile: Object.fromEntries(
        groups.flatMap((group) => {
          const id = groupId(group);
          return compileGapIds.has(id) ? [[id, "compile_exception"] as const] : [];
        }),
      ),
      runtime: Object.fromEntries(
        caseIds.flatMap((id) => {
          const codes = runtimeGapsById.get(id);
          return codes === undefined ? [] : [[id, sortedNonEmptyText(codes)] as const];
        }),
      ),
    },
  };
};

export const buildOfficialSuiteBaseline = ({
  compileGaps,
  groups,
  oracleGaps,
  runtimeGaps,
  suiteCommit,
}: BuildOfficialSuiteBaselineRequest): OfficialSuiteBaseline => {
  const caseIds = selectedCaseIds(groups);
  requireUniqueBuildInputs({ compileGaps, groups, oracleGaps, runtimeGaps, suiteCommit }, caseIds);

  const groupsById = new Map(groups.map((group) => [groupId(group), group] as const));
  const cases = new Set(caseIds);
  const compileGapsById = new Map(compileGaps.map((gap) => [gap.id, gap] as const));
  const compileGapCaseIds = collectCompileGapCaseIds(compileGaps, groupsById);
  const runtimeGapIds = collectRuntimeGapIds(runtimeGaps, cases, compileGapCaseIds);
  requireKnownOracleGaps(oracleGaps, groupsById, cases);

  const diagnosticSets = new Map<string, DiagnosticIdentities>();
  const canonicalCompileGapEntries = groups.flatMap((group) => {
    const id = groupId(group);
    const gap = compileGapsById.get(id);
    if (gap === undefined) return [];
    const diagnostics = canonicalDiagnostics(gap.diagnostics);
    const diagnosticSetSha256 = hashJson(diagnostics);
    diagnosticSets.set(diagnosticSetSha256, diagnostics);
    return [[id, diagnosticSetSha256] as const];
  });
  const canonicalCompileGaps = Object.fromEntries(canonicalCompileGapEntries);
  const compileDiagnosticSets = Object.fromEntries(
    [...diagnosticSets.entries()].toSorted(([left], [right]) => compareText(left, right)),
  );
  const runtimeGapsById = new Map(runtimeGaps.map((gap) => [gap.id, gap] as const));
  const canonicalRuntimeGaps = Object.fromEntries(
    caseIds.flatMap((id) => {
      const gap = runtimeGapsById.get(id);
      return gap === undefined ? [] : [[id, sortedNonEmptyText(gap.codes)] as const];
    }),
  );
  const { events: canonicalOracleGapEvents, gaps: canonicalOracleGaps } = canonicalOracleBaseline(
    oracleGaps,
    groups,
    caseIds,
  );
  const compileGapIds = Object.keys(canonicalCompileGaps);
  const summary = summaryFor({
    caseIds,
    compileGapCaseIds,
    compileGapIds,
    oracleGaps: canonicalOracleGapEvents,
    runtimeGapIds,
  });
  const byDialect = officialSuiteDialects.map(({ dialect }) => {
    const dialectCaseIds = caseIds.filter((id) => dialectFromId(id) === dialect);
    return Object.assign(
      summaryFor({
        caseIds: dialectCaseIds,
        compileGapCaseIds,
        compileGapIds: compileGapIds.filter((id) => dialectFromId(id) === dialect),
        oracleGaps: canonicalOracleGapEvents.filter((gap) => dialectFromId(gap.id) === dialect),
        runtimeGapIds,
      }),
      { dialect, testCount: dialectCaseIds.length },
    );
  });

  return officialSuiteBaselineSchema.parse({
    byDialect,
    caseCount: caseIds.length,
    caseInventorySha256: hashCaseInventory(caseIds),
    compileDiagnosticSets,
    compileGaps: canonicalCompileGaps,
    oracleGaps: canonicalOracleGaps,
    runtimeGaps: canonicalRuntimeGaps,
    suiteCommit,
    summary,
    version: 1,
  });
};

export { diffOfficialSuiteBaselines } from "./baseline-diff";
