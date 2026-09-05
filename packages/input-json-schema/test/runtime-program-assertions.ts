import assert from "node:assert/strict";

import type { ZodEmissionModuleInput } from "@x2zod/core";

export const assertRuntimeEntrypointPrograms = (
  module: ZodEmissionModuleInput,
  symbols: readonly string[],
): void => {
  const guarded = module.declarations.filter(
    (declaration) => declaration.exportExpression !== undefined,
  );
  assert.deepEqual(guarded.map((declaration) => declaration.symbol).toSorted(), symbols.toSorted());
  const programIds = new Set<string>();
  for (const declaration of guarded) {
    const guard = declaration.exportExpression;
    assert.equal(guard?.kind, "runtime-guard");
    assert.equal(guard.placement, "encoded-input");
    assert.equal(guard.expression.kind, "reference");
    assert.equal(guard.expression.symbol, declaration.symbol);
    assert.notEqual(declaration.expression.kind, "runtime-guard");
    assert.equal(
      module.runtimePrograms?.some((program) => program.id === guard.program),
      true,
    );
    programIds.add(guard.program);
  }
  assert.equal(programIds.size, symbols.length);
  assert.equal(module.runtimePrograms?.length, programIds.size);
};
