import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { test } from "node:test";

import {
  buildOfficialSuiteBaseline,
  diffOfficialSuiteBaselines,
  officialSuiteBaselineFile,
  officialSuiteBaselineSchema,
} from "./baseline";
import { parseDiagnosticIdentity } from "./diagnostic-contract";
import {
  officialSuiteSupportSummaryMatches,
  renderOfficialSuiteSupportSummary,
  updateOfficialSuiteSupportSummary,
} from "./documentation";
import { describeSuiteId, parseJsonFile } from "./fixture-support";
import type { SelectedGroup } from "./fixture-support";

const expectedFixtureCaseCount = 3;
const maximumReportedDifferences = 20;
const conformanceDocumentationFile = nodePath.resolve(
  import.meta.dirname,
  "../../../../docs/json-schema-conformance.md",
);

const groups = [
  {
    dialect: "draft-7",
    file: "compile.json",
    group: {
      description: "compile gap",
      schema: { multipleOf: 2 },
      tests: [
        { data: 2, description: "valid", valid: true },
        { data: 3, description: "invalid", valid: false },
      ],
    },
    groupIndex: 0,
  },
  {
    dialect: "draft-2019-09",
    file: "runtime.json",
    group: {
      description: "runtime gap",
      schema: { type: "integer" },
      tests: [{ data: 1, description: "valid", valid: true }],
    },
    groupIndex: 0,
  },
] as const satisfies readonly SelectedGroup[];

const compileDiagnostic = parseDiagnosticIdentity({
  code: "unsupported_keyword",
  message: "multipleOf is unsupported",
  pointer: "/multipleOf",
  severity: "error",
});

void test("builds a compact deterministic full-suite baseline", () => {
  const baseline = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [
      { code: "validity_mismatch", id: "draft-2019-09:runtime.json:0:0", phase: "runtime" },
    ],
    runtimeGaps: [
      {
        codes: ["parse_identity_mismatch"],
        id: "draft-2019-09:runtime.json:0:0",
        phase: "runtime",
      },
    ],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });

  assert.equal(baseline.caseCount, expectedFixtureCaseCount);
  assert.equal(baseline.summary.compileGapGroupCount, 1);
  assert.equal(baseline.summary.compileGapCaseCount, 2);
  assert.equal(baseline.summary.runtimeGapCaseCount, 1);
  assert.equal(baseline.summary.conformingCaseCount, 0);
  assert.equal(baseline.summary.oracleDiscrepancyCount, 1);
  assert.match(baseline.caseInventorySha256, /^[0-9a-f]{64}$/u);
  assert.match(baseline.summary.gapCaseInventorySha256, /^[0-9a-f]{64}$/u);
  assert.match(baseline.summary.passingCaseInventorySha256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.keys(baseline.compileDiagnosticSets).length, 1);
  assert.deepEqual(Object.values(baseline.compileDiagnosticSets), [[compileDiagnostic]]);
  assert.match(baseline.compileGaps["draft-7:compile.json:0"] ?? "", /^[0-9a-f]{64}$/u);
  assert.deepEqual(baseline.runtimeGaps, {
    "draft-2019-09:runtime.json:0:0": ["parse_identity_mismatch"],
  });
  assert.deepEqual(baseline.oracleGaps, {
    compile: {},
    runtime: { "draft-2019-09:runtime.json:0:0": ["validity_mismatch"] },
  });
  assert.deepEqual(
    baseline.byDialect.map((entry) => ({
      conformingCaseCount: entry.conformingCaseCount,
      dialect: entry.dialect,
      testCount: entry.testCount,
    })),
    [
      { conformingCaseCount: 0, dialect: "draft-7", testCount: 2 },
      { conformingCaseCount: 0, dialect: "draft-2019-09", testCount: 1 },
      { conformingCaseCount: 0, dialect: "draft-2020-12", testCount: 0 },
    ],
  );
});

void test("renders current support counts as a reviewable Markdown block", () => {
  const baseline = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [
      { code: "validity_mismatch", id: "draft-2019-09:runtime.json:0:0", phase: "runtime" },
    ],
    runtimeGaps: [
      {
        codes: ["parse_identity_mismatch"],
        id: "draft-2019-09:runtime.json:0:0",
        phase: "runtime",
      },
    ],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });

  assert.equal(
    renderOfficialSuiteSupportSummary(baseline),
    `<!-- BEGIN OFFICIAL SUITE SUPPORT SUMMARY -->

At suite commit \`b01af8c8d50244a2eb4dd3e01073e24823aa8691\`, 0 of 3
required cases currently conform. The baseline records 2 cases in 1 schema group that do
not compile and 1 case-level runtime gap. These case counts measure this corpus, not a
percentage of JSON Schema semantics: test cases and language features are not equally weighted.

The baseline also records 1 discrepancy between the suite's authoritative expected
results and the reference-validator sanity check. That discrepancy is tracked separately from
\`x2zod\` support gaps and does not replace the suite's expected results.

<!-- END OFFICIAL SUITE SUPPORT SUMMARY -->`,
  );
});

void test("keeps current support documentation aligned with the checked-in baseline", async () => {
  const baseline = await parseJsonFile(officialSuiteBaselineFile, officialSuiteBaselineSchema);
  const documentation = await readFile(conformanceDocumentationFile, "utf8");

  assert.ok(
    officialSuiteSupportSummaryMatches(documentation, baseline),
    "JSON Schema conformance documentation must contain the rendered current-support summary.",
  );
});

void test("updates only the marked current-support documentation block", () => {
  const baseline = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [],
    runtimeGaps: [],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });
  const document = `Before

<!-- BEGIN OFFICIAL SUITE SUPPORT SUMMARY -->

stale summary

<!-- END OFFICIAL SUITE SUPPORT SUMMARY -->

After
`;

  assert.equal(
    updateOfficialSuiteSupportSummary(document, baseline),
    `Before

${renderOfficialSuiteSupportSummary(baseline)}

After
`,
  );
});

void test("matches the support summary after Markdown formatting reflows it", () => {
  const baseline = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [],
    runtimeGaps: [],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });
  const formattedDocumentation = `Before

<!-- BEGIN OFFICIAL SUITE SUPPORT SUMMARY -->

At suite commit \`b01af8c8d50244a2eb4dd3e01073e24823aa8691\`, 1 of 3 required cases currently
conform. The baseline records 2 cases in 1 schema group that do not compile and 0 case-level runtime
gaps. These case counts measure this corpus, not a percentage of JSON Schema semantics: test cases
and language features are not equally weighted.

The baseline also records 0 discrepancies between the suite's authoritative expected results and
the reference-validator sanity check. Those discrepancies are tracked separately from \`x2zod\`
support gaps and do not replace the suite's expected results.

<!-- END OFFICIAL SUITE SUPPORT SUMMARY -->

After
`;

  assert.equal(officialSuiteSupportSummaryMatches(formattedDocumentation, baseline), true);
});

void test("reports bounded, actionable baseline drift", () => {
  const expected = buildOfficialSuiteBaseline({
    compileGaps: [],
    groups,
    oracleGaps: [],
    runtimeGaps: [],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });
  const observed = buildOfficialSuiteBaseline({
    compileGaps: [],
    groups,
    oracleGaps: [
      { code: "compile_exception", id: "draft-7:compile.json:0", phase: "compile" },
      { code: "validity_mismatch", id: "draft-2019-09:runtime.json:0:0", phase: "runtime" },
    ],
    runtimeGaps: [
      { codes: ["validity_mismatch"], id: "draft-2019-09:runtime.json:0:0", phase: "runtime" },
    ],
    suiteCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });

  assert.deepEqual(diffOfficialSuiteBaselines(expected, expected), []);
  const differences = diffOfficialSuiteBaselines(observed, expected, {
    describeId: (id) => describeSuiteId(groups, id),
  });
  assert.ok(differences.length > 0);
  assert.ok(differences.length <= maximumReportedDifferences);
  const report = differences.join("\n");
  assert.match(report, /suite commit changed/iu);
  assert.match(report, /runtime gap.*draft-2019-09:runtime\.json:0:0/iu);
  assert.match(report, /oracle compile discrepancy.*draft-7:compile\.json:0/iu);
  assert.match(report, /oracle runtime discrepancy.*draft-2019-09:runtime\.json:0:0/iu);
  assert.match(report, /group "runtime gap"; case "valid"/u);
  assert.match(report, /summary changed/iu);
  assert.match(report, /dialect summaries changed/iu);
});

void test("rejects duplicate observed gaps and persisted gap codes", () => {
  const compileGap = { diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" } as const;
  const runtimeGap = {
    codes: ["validity_mismatch"],
    id: "draft-2019-09:runtime.json:0:0",
    phase: "runtime",
  } as const;
  const oracleGap = {
    code: "validity_mismatch",
    id: "draft-2019-09:runtime.json:0:0",
    phase: "runtime",
  } as const;
  const baseline = buildOfficialSuiteBaseline({
    compileGaps: [compileGap],
    groups,
    oracleGaps: [oracleGap],
    runtimeGaps: [runtimeGap],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });

  assert.throws(
    () =>
      buildOfficialSuiteBaseline({
        compileGaps: [compileGap, compileGap],
        groups,
        oracleGaps: [oracleGap],
        runtimeGaps: [runtimeGap],
        suiteCommit: baseline.suiteCommit,
      }),
    /Compile gap ids must be unique/u,
  );
  assert.throws(
    () =>
      buildOfficialSuiteBaseline({
        compileGaps: [compileGap],
        groups,
        oracleGaps: [oracleGap],
        runtimeGaps: [runtimeGap, runtimeGap],
        suiteCommit: baseline.suiteCommit,
      }),
    /Runtime gap ids must be unique/u,
  );
  assert.throws(
    () =>
      buildOfficialSuiteBaseline({
        compileGaps: [compileGap],
        groups,
        oracleGaps: [oracleGap, oracleGap],
        runtimeGaps: [runtimeGap],
        suiteCommit: baseline.suiteCommit,
      }),
    /Oracle gap identities must be unique/u,
  );
  assert.throws(() =>
    officialSuiteBaselineSchema.parse({
      ...baseline,
      runtimeGaps: {
        ...baseline.runtimeGaps,
        [runtimeGap.id]: ["validity_mismatch", "validity_mismatch"],
      },
    }),
  );
  assert.throws(() =>
    officialSuiteBaselineSchema.parse({
      ...baseline,
      oracleGaps: {
        ...baseline.oracleGaps,
        runtime: {
          ...baseline.oracleGaps.runtime,
          [oracleGap.id]: ["validity_mismatch", "validity_mismatch"],
        },
      },
    }),
  );
});

void test("diagnostic drift includes the changed diagnostic text", () => {
  const expected = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [compileDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [],
    runtimeGaps: [],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });
  const changedDiagnostic = parseDiagnosticIdentity({
    ...compileDiagnostic,
    message: "multipleOf lowering changed",
  });
  const observed = buildOfficialSuiteBaseline({
    compileGaps: [{ diagnostics: [changedDiagnostic], id: "draft-7:compile.json:0" }],
    groups,
    oracleGaps: [],
    runtimeGaps: [],
    suiteCommit: "b01af8c8d50244a2eb4dd3e01073e24823aa8691",
  });

  const differences = diffOfficialSuiteBaselines(observed, expected).join("\n");
  assert.match(differences, /multipleOf is unsupported/u);
  assert.match(differences, /multipleOf lowering changed/u);
});
