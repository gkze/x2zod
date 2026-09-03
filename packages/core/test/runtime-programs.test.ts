import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, test } from "node:test";

import {
  buildNodeBundle,
  importGeneratedExport,
  isRecord,
} from "../../../test/native-source-harness";
import {
  createGeneratedSourceHarness,
  emitGeneratedDeclarations,
} from "./generated-source-harness";

const corePackageRootDirectory = nodePath.resolve(import.meta.dirname, "..");
const sourcePrinterEntryPoint = nodePath.join(
  import.meta.dirname,
  "runtime-program-print-helper.ts",
);
const invalidNumberValue = 42;

type RuntimeParseResult = Readonly<{ success: boolean }>;
type RuntimeZodSchema = Readonly<{ safeParse: (value: unknown) => RuntimeParseResult }>;
type RuntimeZodCodec = Readonly<{
  decode: (value: unknown) => object;
  encode: (value: unknown) => unknown;
  safeDecode: (value: unknown) => RuntimeParseResult;
}>;

const isRuntimeZodSchema = (value: unknown): value is RuntimeZodSchema =>
  isRecord(value) && typeof value["safeParse"] === "function";

const isRuntimeZodCodec = (value: unknown): value is RuntimeZodCodec =>
  isRecord(value) &&
  typeof value["decode"] === "function" &&
  typeof value["encode"] === "function" &&
  typeof value["safeDecode"] === "function";

void describe("typed runtime programs", () => {
  void test("guard encoded input while preserving structural inference", async () => {
    const harness = createGeneratedSourceHarness({
      prefix: "x2zod-runtime-program-",
      printerEntryPoint: sourcePrinterEntryPoint,
    });

    try {
      const printed = harness.print();
      writeFileSync(harness.generatedFile, printed);
      emitGeneratedDeclarations(
        harness.generatedFile,
        nodePath.join(harness.directory, "declarations"),
      );
      buildNodeBundle({
        cwd: corePackageRootDirectory,
        entryPoint: harness.generatedFile,
        externals: [],
        outfile: `${harness.generatedFile}.mjs`,
      });

      const schema = await importGeneratedExport(
        harness.generatedFile,
        "userSchema",
        isRuntimeZodSchema,
      );
      assert.equal(schema.safeParse("allowed").success, true);
      assert.equal(schema.safeParse("forbidden").success, false);
      assert.equal(schema.safeParse(invalidNumberValue).success, false);
      assert.equal(schema.safeParse("repeat").success, true);
      assert.equal(schema.safeParse("repeat").success, false);
      assert.match(printed, /const x2zodRuntimeProgram0/u);
      assert.match(printed, /x2zodApplyRuntimePredicate/u);
    } finally {
      harness.dispose();
    }
  });
});

void describe("mutual recursive runtime programs", () => {
  void test("compose with transformed declarations across a mutual recursive component", async () => {
    const harness = createGeneratedSourceHarness({
      prefix: "x2zod-runtime-program-",
      printerEntryPoint: sourcePrinterEntryPoint,
    });

    try {
      const printed = harness.print(["mutual-recursive-transform"]);
      writeFileSync(harness.generatedFile, printed);
      emitGeneratedDeclarations(
        harness.generatedFile,
        nodePath.join(harness.directory, "declarations"),
      );
      const userSchema = await importGeneratedExport(
        harness.generatedFile,
        "userSchema",
        isRuntimeZodCodec,
      );
      const peerSchema = await importGeneratedExport(
        harness.generatedFile,
        "peerSchema",
        isRuntimeZodCodec,
      );
      const rootWire = {
        peer: { peer_label: "peer-1", root: { root_label: "root-2" } },
        root_label: "root-1",
      };
      const rootDecoded = {
        peer: { peerLabel: "peer-1", root: { rootLabel: "root-2" } },
        rootLabel: "root-1",
      };
      const peerWire = {
        peer_label: "peer-2",
        root: { peer: { peer_label: "peer-3" }, root_label: "root-3" },
      };
      const peerDecoded = {
        peerLabel: "peer-2",
        root: { peer: { peerLabel: "peer-3" }, rootLabel: "root-3" },
      };

      assert.deepEqual(userSchema.decode(rootWire), rootDecoded);
      assert.deepEqual(userSchema.encode(rootDecoded), rootWire);
      assert.deepEqual(peerSchema.decode(peerWire), peerDecoded);
      assert.deepEqual(peerSchema.encode(peerDecoded), peerWire);
      assert.equal(
        userSchema.safeDecode({
          peer: { blocked: true, peer_label: "blocked-peer" },
          root_label: "root",
        }).success,
        false,
      );
      assert.equal(
        peerSchema.safeDecode({
          peer_label: "peer",
          root: { blocked: true, root_label: "blocked-root" },
        }).success,
        false,
      );
    } finally {
      harness.dispose();
    }
  });
});
