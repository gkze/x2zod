import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { officialSuiteBaselineFile, officialSuiteBaselineSchema } from "./baseline";
import { runOfficialSuiteConformance } from "./conformance-runner";
import {
  officialSuiteSupportSummaryMatches,
  updateOfficialSuiteSupportSummary,
} from "./documentation";
import { parseJsonFile } from "./fixture-support";

const baseline = await runOfficialSuiteConformance();
const formatterBinary = nodePath.resolve(
  import.meta.dirname,
  "../../../../node_modules/.bin/oxfmt",
);
const temporaryBaselineFile = `${officialSuiteBaselineFile}.${process.pid.toString()}.tmp.json`;
const documentationFile = nodePath.resolve(
  import.meta.dirname,
  "../../../../docs/json-schema-conformance.md",
);
const temporaryDocumentationFile = `${documentationFile}.${process.pid.toString()}.tmp.md`;
const updatedDocumentation = updateOfficialSuiteSupportSummary(
  await readFile(documentationFile, "utf8"),
  baseline,
);
try {
  await Promise.all([
    writeFile(temporaryBaselineFile, `${JSON.stringify(baseline, undefined, 2)}\n`),
    writeFile(temporaryDocumentationFile, updatedDocumentation),
  ]);
  const formatResult = spawnSync(
    formatterBinary,
    ["--write", "--threads=1", temporaryBaselineFile, temporaryDocumentationFile],
    { encoding: "utf8", killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
  );
  if (formatResult.error !== undefined)
    throw new Error("Official-suite baseline formatter failed.", { cause: formatResult.error });
  assert.equal(formatResult.status, 0, [formatResult.stdout, formatResult.stderr].join("\n"));
  assert.deepEqual(
    await parseJsonFile(temporaryBaselineFile, officialSuiteBaselineSchema),
    baseline,
  );
  const formattedDocumentation = await readFile(temporaryDocumentationFile, "utf8");
  assert.ok(officialSuiteSupportSummaryMatches(formattedDocumentation, baseline));
  await Promise.all([
    rename(temporaryBaselineFile, officialSuiteBaselineFile),
    rename(temporaryDocumentationFile, documentationFile),
  ]);
} finally {
  await Promise.all([
    rm(temporaryBaselineFile, { force: true }),
    rm(temporaryDocumentationFile, { force: true }),
  ]);
}
assert.deepEqual(
  await parseJsonFile(officialSuiteBaselineFile, officialSuiteBaselineSchema),
  baseline,
);
const writtenDocumentation = await readFile(documentationFile, "utf8");
assert.ok(officialSuiteSupportSummaryMatches(writtenDocumentation, baseline));

process.stdout.write(
  `Updated ${officialSuiteBaselineFile} and ${documentationFile}\n` +
    `${baseline.summary.conformingCaseCount.toString()} of ` +
    `${baseline.caseCount.toString()} required cases currently conform; ` +
    `${baseline.summary.compileGapCaseCount.toString()} compile-gap cases and ` +
    `${baseline.summary.runtimeGapCaseCount.toString()} runtime-gap cases remain.\n`,
);
