import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { describe, test } from "node:test";

import { importGeneratedExport, isRecord } from "../../../test/native-source-harness";
import {
  createGeneratedSourceHarness,
  emitGeneratedDeclarations,
} from "./generated-source-harness";

type RuntimeSchema = Readonly<{
  decode: (value: unknown) => unknown;
  encode: (value: unknown) => unknown;
}>;
const isRuntimeSchema = (value: unknown): value is RuntimeSchema =>
  isRecord(value) && typeof value["decode"] === "function" && typeof value["encode"] === "function";
const printerEntryPoint = nodePath.join(import.meta.dirname, "source-print-helper.ts");
// Concurrent Nix checks exceed the runner's 5s default for this native toolchain.
// Bound printing and declaration emit separately, leaving time for bundle setup and cleanup.
const nativeProcessTimeoutMs = 10_000;
const integrationTestOptions = { timeout: 30_000 };

void describe("generated declaration and transform contracts", () => {
  void test(
    "preserves nested codecs and own prototype fields in both directions",
    integrationTestOptions,
    async () => {
      const harness = createGeneratedSourceHarness({
        prefix: "x2zod-preserved-codec-",
        printerEntryPoint,
        nativeProcessTimeoutMs,
      });
      try {
        await writeFile(
          harness.generatedFile,
          harness.print(["nested-preserved-property-transform"]),
        );
        emitGeneratedDeclarations(
          harness.generatedFile,
          nodePath.join(harness.directory, "declarations"),
          nativeProcessTimeoutMs,
        );
        const schema = await importGeneratedExport(
          harness.generatedFile,
          "userSchema",
          isRuntimeSchema,
        );
        const encoded: unknown = JSON.parse(
          '{"nested":{"first_name":"Jane"},"__proto__":{"proto_value":"kept"},"extra_key":true}',
        );
        const decoded: unknown = JSON.parse(
          '{"nested":{"firstName":"Jane"},"Proto":{"protoValue":"kept"},"extra_key":true}',
        );
        assert.deepEqual(schema.decode(encoded), decoded);
        assert.deepEqual(schema.encode(decoded), encoded);
        assert.deepEqual(schema.decode({ nested: { first_name: "Jane" } }), {
          nested: { firstName: "Jane" },
        });
        assert.deepEqual(schema.encode({ nested: { firstName: "Jane" } }), {
          nested: { first_name: "Jane" },
        });
      } finally {
        harness.dispose();
      }
    },
  );

  void test(
    "preserves transformed catchall values under dynamic keys",
    integrationTestOptions,
    async () => {
      const harness = createGeneratedSourceHarness({
        prefix: "x2zod-preserved-catchall-",
        printerEntryPoint,
        nativeProcessTimeoutMs,
      });
      try {
        await writeFile(harness.generatedFile, harness.print(["preserved-catchall-transform"]));
        emitGeneratedDeclarations(
          harness.generatedFile,
          nodePath.join(harness.directory, "declarations"),
          nativeProcessTimeoutMs,
        );
        const schema = await importGeneratedExport(
          harness.generatedFile,
          "userSchema",
          isRuntimeSchema,
        );
        const encoded: unknown = JSON.parse(
          '{"dynamic_key":{"first_name":"Jane"},"__proto__":{"first_name":"kept"}}',
        );
        const decoded: unknown = JSON.parse(
          '{"dynamic_key":{"firstName":"Jane"},"__proto__":{"firstName":"kept"}}',
        );
        assert.deepEqual(schema.decode(encoded), decoded);
        assert.deepEqual(schema.encode(decoded), encoded);
      } finally {
        harness.dispose();
      }
    },
  );
});

void describe("recursive declaration and naming contracts", () => {
  void test("transforms named recursive preserving wrappers", integrationTestOptions, async () => {
    const harness = createGeneratedSourceHarness({
      prefix: "x2zod-recursive-preserved-",
      printerEntryPoint,
      nativeProcessTimeoutMs,
    });
    try {
      await writeFile(harness.generatedFile, harness.print(["recursive-preserved-transform"]));
      emitGeneratedDeclarations(
        harness.generatedFile,
        nodePath.join(harness.directory, "declarations"),
        nativeProcessTimeoutMs,
      );
      const schema = await importGeneratedExport(
        harness.generatedFile,
        "userSchema",
        isRuntimeSchema,
      );
      const encoded = { node: { snake_key: "root", extra_key: true, next: { snake_key: "leaf" } } };
      const decoded = { node: { snakeKey: "root", extra_key: true, next: { snakeKey: "leaf" } } };
      assert.deepEqual(schema.decode(encoded), decoded);
      assert.deepEqual(schema.encode(decoded), encoded);
    } finally {
      harness.dispose();
    }
  });

  void test(
    "retains optional references and trailing tuple items in recursive types",
    integrationTestOptions,
    async () => {
      const harness = createGeneratedSourceHarness({
        prefix: "x2zod-recursive-optionality-",
        printerEntryPoint,
        nativeProcessTimeoutMs,
      });
      try {
        await writeFile(harness.generatedFile, harness.print(["recursive-optionality", "Exclude"]));
        const consumer = nodePath.join(harness.directory, "consumer.ts");
        await writeFile(
          consumer,
          [
            'import { z } from "zod/v4";',
            'import { excludeSchema } from "./generated-runtime.js";',
            'const input: z.input<typeof excludeSchema> = { tuple: [], requiredValue: "ok" };',
            'const output: z.output<typeof excludeSchema> = { tuple: ["value"], requiredValue: "ok", next: input };',
            "export { input, output };",
          ].join("\n"),
        );
        emitGeneratedDeclarations(
          consumer,
          nodePath.join(harness.directory, "declarations"),
          nativeProcessTimeoutMs,
        );
        const schema = await importGeneratedExport(
          harness.generatedFile,
          "excludeSchema",
          isRuntimeSchema,
        );
        const value = {
          tuple: [],
          requiredValue: "ok",
          next: { tuple: ["value"], requiredValue: "ok" },
        };
        assert.deepEqual(schema.decode(value), value);
      } finally {
        harness.dispose();
      }
    },
  );
});

const namingCases = [
  { name: "allows a public Record type alongside codec helper types", mode: "property-transform" },
  {
    name: "allows a public Record type alongside recursive passthrough types",
    mode: "recursive-passthrough",
  },
  {
    name: "emits valid composed record-key types alongside a public Record type",
    mode: "record-keys",
  },
] as const;

void describe("generated utility type names", () => {
  for (const namingCase of namingCases)
    void test(namingCase.name, integrationTestOptions, () => {
      const harness = createGeneratedSourceHarness({
        prefix: "x2zod-global-types-",
        printerEntryPoint,
        nativeProcessTimeoutMs,
      });
      try {
        writeFileSync(harness.generatedFile, harness.print([namingCase.mode, "Record"]));
        emitGeneratedDeclarations(
          harness.generatedFile,
          nodePath.join(harness.directory, "declarations"),
          nativeProcessTimeoutMs,
        );
      } finally {
        harness.dispose();
      }
    });
});
