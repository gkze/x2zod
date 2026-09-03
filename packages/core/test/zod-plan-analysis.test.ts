import assert from "node:assert/strict";
import { test } from "node:test";

import { zodDeclaration, zodModule, zodPlan, zodSymbol } from "../src";
import { collectCyclicZodDeclarationPeers } from "../src/zod-plan-analysis";

void test("identifies only declarations in each strongly connected component", () => {
  const root = zodSymbol("root");
  const left = zodSymbol("left");
  const right = zodSymbol("right");
  const leaf = zodSymbol("leaf");
  const peers = collectCyclicZodDeclarationPeers(
    zodModule(root, [
      zodDeclaration(root, zodPlan.reference(left)),
      zodDeclaration(left, zodPlan.object({ right: zodPlan.reference(right) })),
      zodDeclaration(right, zodPlan.object({ left: zodPlan.reference(left) })),
      zodDeclaration(leaf, zodPlan.string()),
    ]),
  );

  assert.deepEqual(peers.get(left), new Set([left, right]));
  assert.deepEqual(peers.get(right), new Set([left, right]));
  assert.equal(peers.has(root), false);
  assert.equal(peers.has(leaf), false);
});

void test("identifies self-referential declarations as one-member cycles", () => {
  const root = zodSymbol("root");
  const peers = collectCyclicZodDeclarationPeers(
    zodModule(root, [zodDeclaration(root, zodPlan.reference(root))]),
  );

  assert.deepEqual(peers.get(root), new Set([root]));
});
