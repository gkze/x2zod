import type { OfficialSuiteBaseline, OfficialSuiteBaselineDiffOptions } from "./baseline";

const differenceLimit = 20;
const differenceValueLimit = 500;
const sortBefore = -1;
const sortEqual = 0;
const sortAfter = 1;

type DisplayId = (id: string) => string;
type BaselineGapDifferencesRequest = Readonly<{
  displayId: DisplayId;
  expected: OfficialSuiteBaseline;
  observed: OfficialSuiteBaseline;
}>;
type KeyedDifferencesRequest<TValue> = Readonly<{
  displayKey?: ((key: string) => string) | undefined;
  expectedValues: ReadonlyMap<string, TValue>;
  label: string;
  observedValues: ReadonlyMap<string, TValue>;
}>;
type ValueDifferenceRequest = Readonly<{
  expectedValue: unknown;
  label: string;
  observedValue: unknown;
}>;

const compareText = (left: string, right: string): number => {
  if (left === right) return sortEqual;
  return left < right ? sortBefore : sortAfter;
};

const compactValue = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  return serialized.length <= differenceValueLimit
    ? serialized
    : `${serialized.slice(0, differenceValueLimit)}...`;
};

const recordMap = <TValue>(values: Readonly<Record<string, TValue>>): ReadonlyMap<string, TValue> =>
  new Map(Object.entries(values));

const createDisplayId =
  (options: OfficialSuiteBaselineDiffOptions): DisplayId =>
  (id) => {
    const description = options.describeId?.(id);
    return description === undefined ? id : `${id} (${description})`;
  };

const valueDifferences = ({
  expectedValue,
  label,
  observedValue,
}: ValueDifferenceRequest): readonly string[] =>
  JSON.stringify(observedValue) === JSON.stringify(expectedValue)
    ? []
    : [
        `${label} changed: expected ${compactValue(expectedValue)}, observed ${compactValue(observedValue)}`,
      ];

const keyedDifferences = <TValue>({
  displayKey = (key) => key,
  expectedValues,
  label,
  observedValues,
}: KeyedDifferencesRequest<TValue>): readonly string[] => {
  const keys = [...new Set([...observedValues.keys(), ...expectedValues.keys()])].toSorted(
    compareText,
  );
  return keys.flatMap((key) => {
    const observedValue = observedValues.get(key);
    const expectedValue = expectedValues.get(key);
    const displayedKey = displayKey(key);
    if (observedValue === undefined) return [`missing ${label} ${displayedKey}`];
    if (expectedValue === undefined) return [`unexpected ${label} ${displayedKey}`];
    return valueDifferences({ expectedValue, label: `${label} ${displayedKey}`, observedValue });
  });
};

const compileGapDifferences = ({
  displayId,
  expected,
  observed,
}: BaselineGapDifferencesRequest): readonly string[] => {
  const observedGaps = recordMap(observed.compileGaps);
  const expectedGaps = recordMap(expected.compileGaps);
  const ids = [...new Set([...observedGaps.keys(), ...expectedGaps.keys()])].toSorted(compareText);
  return ids.flatMap((id) => {
    const observedDiagnosticSetSha256 = observedGaps.get(id);
    const expectedDiagnosticSetSha256 = expectedGaps.get(id);
    const observedDiagnostics =
      observedDiagnosticSetSha256 === undefined
        ? undefined
        : observed.compileDiagnosticSets[observedDiagnosticSetSha256];
    const expectedDiagnostics =
      expectedDiagnosticSetSha256 === undefined
        ? undefined
        : expected.compileDiagnosticSets[expectedDiagnosticSetSha256];
    if (observedDiagnosticSetSha256 === undefined)
      return [`missing compile gap ${displayId(id)}: ${compactValue(expectedDiagnostics)}`];
    if (expectedDiagnosticSetSha256 === undefined)
      return [`unexpected compile gap ${displayId(id)}: ${compactValue(observedDiagnostics)}`];
    return observedDiagnosticSetSha256 === expectedDiagnosticSetSha256
      ? []
      : [
          `compile gap ${displayId(id)} changed: expected ${compactValue(expectedDiagnostics)}, ` +
            `observed ${compactValue(observedDiagnostics)}`,
        ];
  });
};

const runtimeGapDifferences = ({
  displayId,
  expected,
  observed,
}: BaselineGapDifferencesRequest): readonly string[] =>
  keyedDifferences({
    displayKey: displayId,
    expectedValues: recordMap(expected.runtimeGaps),
    label: "runtime gap",
    observedValues: recordMap(observed.runtimeGaps),
  });

const oracleGapDifferences = ({
  displayId,
  expected,
  observed,
}: BaselineGapDifferencesRequest): readonly string[] => [
  ...keyedDifferences({
    displayKey: displayId,
    expectedValues: recordMap(expected.oracleGaps.compile),
    label: "oracle compile discrepancy",
    observedValues: recordMap(observed.oracleGaps.compile),
  }),
  ...keyedDifferences({
    displayKey: displayId,
    expectedValues: recordMap(expected.oracleGaps.runtime),
    label: "oracle runtime discrepancy",
    observedValues: recordMap(observed.oracleGaps.runtime),
  }),
];

const boundedDifferences = (differences: readonly string[]): readonly string[] => {
  if (differences.length <= differenceLimit) return differences;
  const visibleCount = differenceLimit - 1;
  return [
    ...differences.slice(0, visibleCount),
    `${(differences.length - visibleCount).toString()} additional differences omitted`,
  ];
};

export const diffOfficialSuiteBaselines = (
  observed: OfficialSuiteBaseline,
  expected: OfficialSuiteBaseline,
  options: OfficialSuiteBaselineDiffOptions = {},
): readonly string[] => {
  const displayId = createDisplayId(options);
  const gapDifferenceRequest = { displayId, expected, observed };
  const metadataDifferences = [
    { expectedValue: expected.version, label: "version", observedValue: observed.version },
    {
      expectedValue: expected.suiteCommit,
      label: "suite commit",
      observedValue: observed.suiteCommit,
    },
    { expectedValue: expected.caseCount, label: "case count", observedValue: observed.caseCount },
    {
      expectedValue: expected.caseInventorySha256,
      label: "case inventory hash",
      observedValue: observed.caseInventorySha256,
    },
  ].flatMap((request) => valueDifferences(request));
  return boundedDifferences([
    ...metadataDifferences,
    ...compileGapDifferences(gapDifferenceRequest),
    ...runtimeGapDifferences(gapDifferenceRequest),
    ...oracleGapDifferences(gapDifferenceRequest),
    ...valueDifferences({
      expectedValue: expected.summary,
      label: "summary",
      observedValue: observed.summary,
    }),
    ...valueDifferences({
      expectedValue: expected.byDialect,
      label: "dialect summaries",
      observedValue: observed.byDialect,
    }),
  ]);
};
