import type { OfficialSuiteBaseline } from "./baseline";

const summaryStartMarker = "<!-- BEGIN OFFICIAL SUITE SUPPORT SUMMARY -->";
const summaryEndMarker = "<!-- END OFFICIAL SUITE SUPPORT SUMMARY -->";
const missingIndex = -1;
const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
type SummaryRange = Readonly<{ end: number; start: number }>;

const formatCount = (count: number): string => countFormatter.format(count);

const counted = (count: number, singular: string, plural = `${singular}s`): string =>
  `${formatCount(count)} ${count === 1 ? singular : plural}`;

const supportSummaryRange = (documentation: string): SummaryRange => {
  const start = documentation.indexOf(summaryStartMarker);
  const endMarkerStart = documentation.indexOf(summaryEndMarker);
  const markersAreUnique =
    start !== missingIndex &&
    endMarkerStart !== missingIndex &&
    !documentation.includes(summaryStartMarker, start + summaryStartMarker.length) &&
    !documentation.includes(summaryEndMarker, endMarkerStart + summaryEndMarker.length);
  if (!markersAreUnique || endMarkerStart < start)
    throw new Error("Conformance documentation must contain one ordered support-summary block.");
  return { end: endMarkerStart + summaryEndMarker.length, start };
};

const normalizedMarkdownText = (text: string): string => text.replaceAll(/\s+/gu, " ").trim();

export const renderOfficialSuiteSupportSummary = (baseline: OfficialSuiteBaseline): string => {
  const oracleDiscrepancies = baseline.summary.oracleDiscrepancyCount;
  const singularOracleDiscrepancy = oracleDiscrepancies === 1;
  const requiredCases = baseline.caseCount === 1 ? "required case" : "required cases";
  const compileGapCases = counted(baseline.summary.compileGapCaseCount, "case");
  const compileGapGroups = counted(baseline.summary.compileGapGroupCount, "schema group");
  const runtimeGaps = counted(baseline.summary.runtimeGapCaseCount, "case-level runtime gap");
  const oracleGapCount = counted(oracleDiscrepancies, "discrepancy", "discrepancies");
  const oracleGapSubject = singularOracleDiscrepancy
    ? "That discrepancy is"
    : "Those discrepancies are";
  const oracleGapAgreement = singularOracleDiscrepancy ? "does" : "do";

  return [
    summaryStartMarker,
    "",
    `At suite commit \`${baseline.suiteCommit}\`, ` +
      `${formatCount(baseline.summary.conformingCaseCount)} of ${formatCount(baseline.caseCount)}`,
    `${requiredCases} currently conform. The baseline records ` +
      `${compileGapCases} in ${compileGapGroups} that do`,
    `not compile and ${runtimeGaps}. These case counts measure this corpus, not a`,
    "percentage of JSON Schema semantics: test cases and language features are not equally weighted.",
    "",
    `The baseline also records ${oracleGapCount} between the suite's authoritative expected`,
    `results and the reference-validator sanity check. ${oracleGapSubject} tracked separately from`,
    `\`x2zod\` support gaps and ${oracleGapAgreement} not replace the suite's expected results.`,
    "",
    summaryEndMarker,
  ].join("\n");
};

export const updateOfficialSuiteSupportSummary = (
  documentation: string,
  baseline: OfficialSuiteBaseline,
): string => {
  const { end, start } = supportSummaryRange(documentation);
  return `${documentation.slice(0, start)}${renderOfficialSuiteSupportSummary(baseline)}${documentation.slice(end)}`;
};

export const officialSuiteSupportSummaryMatches = (
  documentation: string,
  baseline: OfficialSuiteBaseline,
): boolean => {
  const { end, start } = supportSummaryRange(documentation);
  return (
    normalizedMarkdownText(documentation.slice(start, end)) ===
    normalizedMarkdownText(renderOfficialSuiteSupportSummary(baseline))
  );
};
