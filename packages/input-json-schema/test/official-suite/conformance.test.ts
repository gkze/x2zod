import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diffOfficialSuiteBaselines,
  officialSuiteBaselineFile,
  officialSuiteBaselineSchema,
} from "./baseline";
import { runOfficialSuiteConformance } from "./conformance-runner";
import { describeSuiteId, loadRequiredGroups, parseJsonFile } from "./fixture-support";

const officialSuiteTestTimeoutMs = 300_000;

void test(
  "matches the required official-suite conformance baseline",
  { timeout: officialSuiteTestTimeoutMs },
  async () => {
    const expected = await parseJsonFile(officialSuiteBaselineFile, officialSuiteBaselineSchema);
    const groups = await loadRequiredGroups();
    const observed = await runOfficialSuiteConformance();
    const differences = diffOfficialSuiteBaselines(observed, expected, {
      describeId: (id) => describeSuiteId(groups, id),
    });

    assert.deepEqual(
      differences,
      [],
      "Official-suite baseline drift. Inspect the listed changes and intentionally regenerate " +
        "the baseline with `bun --no-env-file run test:conformance:update`.",
    );
  },
);
