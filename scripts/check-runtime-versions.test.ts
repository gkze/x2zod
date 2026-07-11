import assert from "node:assert/strict";
import { test } from "node:test";

import { validateRuntimeVersions, validateToolchainDeclarations } from "./check-runtime-versions";
import type {
  ExpectedRuntimeVersions,
  ToolchainDeclarationSources,
} from "./check-runtime-versions";

const expected = { bun: "1.3.14", node: "24.18.0" } as const satisfies ExpectedRuntimeVersions;
const declarations = {
  bunfig: "env = false\ntelemetry = false\n",
  ciWorkflow: "env:\n  BUN_VERSION: 1.3.14\n  NODE_VERSION: 24.18.0\n",
  flake: 'bunVersion = "1.3.14";\nnodeVersion = "24.18.0";\n',
  packageJson: JSON.stringify({
    engines: { bun: "1.3.14", node: "24.18.0" },
    packageManager: "bun@1.3.14",
  }),
  publishWorkflow: "env:\n  BUN_VERSION: 1.3.14\n  NODE_VERSION: 24.18.0\n",
} as const satisfies ToolchainDeclarationSources;

void test("validateRuntimeVersions accepts the repository toolchain", () => {
  assert.doesNotThrow(() => {
    validateRuntimeVersions({ bun: "1.3.14", node: "24.18.0" }, expected);
  });
});

void test("validateRuntimeVersions reports every runtime mismatch", () => {
  assert.throws(() => {
    validateRuntimeVersions({ bun: "1.4.0", node: "25.0.0" }, expected);
  }, /Expected Bun 1\.3\.14; received 1\.4\.0\./u);
  assert.throws(() => {
    validateRuntimeVersions({ bun: "1.4.0", node: "25.0.0" }, expected);
  }, /Expected Node\.js 24\.18\.0; received 25\.0\.0\./u);
});

void test("validateToolchainDeclarations accepts aligned repository declarations", () => {
  assert.doesNotThrow(() => {
    validateToolchainDeclarations(expected, declarations);
  });
});

void test("validateToolchainDeclarations reports drift across every declaration surface", () => {
  const drifted = {
    ...declarations,
    bunfig: "env = true\ntelemetry = true\n",
    ciWorkflow: "env:\n  BUN_VERSION: 1.4.0\n  NODE_VERSION: 25.0.0\n",
    flake: 'bunVersion = "1.4.0";\nnodeVersion = "25.0.0";\n',
    packageJson: JSON.stringify({
      engines: { bun: "1.4.0", node: "25.0.0" },
      packageManager: "bun@1.4.0",
    }),
  } satisfies ToolchainDeclarationSources;

  assert.throws(() => {
    validateToolchainDeclarations(expected, drifted);
  }, /package\.json engines\.bun: expected 1\.3\.14; received 1\.4\.0\./u);
  assert.throws(() => {
    validateToolchainDeclarations(expected, drifted);
  }, /ci\.yml NODE_VERSION: expected 24\.18\.0; received 25\.0\.0\./u);
  assert.throws(() => {
    validateToolchainDeclarations(expected, drifted);
  }, /flake\.nix bunVersion: expected 1\.3\.14; received 1\.4\.0\./u);
  assert.throws(() => {
    validateToolchainDeclarations(expected, drifted);
  }, /bunfig\.toml env: expected false; received true\./u);
});
