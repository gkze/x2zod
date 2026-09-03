import assert from "node:assert/strict";
import { test } from "node:test";

import { compareCodeUnits } from "../src/string-order";

void test("orders generated resources by locale-independent UTF-16 code units", () => {
  assert.deepEqual(["å", "z", "ä", "a"].toSorted(compareCodeUnits), ["a", "z", "ä", "å"]);
});
